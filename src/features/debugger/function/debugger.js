const fs = require("fs");
const createKeccakHash = require("keccak");
const path = require("path");
const vscode = require("vscode");

// TODO: use a slimmer abicoder
const { AbiCoder } = require("@ethersproject/abi");
const { hevmConfig } = require("../../../options");
const {
  deployContract,
  runInUserTerminal,
  writeHevmCommand,
  resetStateRepo,
  registerError,
  compileFromFile,
  checkInstallations,
  purgeCache,
  craftTerminalCommand,
} = require("../debuggerUtils");
const { isWsl, wslMountedDriveRegex } = require("../../../settings");

/**Start function debugger
 *
 * @param {String} sourceDirectory The current working directory of selected files workspace
 * @param {String} currentFile The path to the currently selected file
 * @param {String} functionSelector The 4byte function selector of the transaction being debugged
 * @param {Array<Array<String>>} argsArray Each arg is provided in the format [type, value] so that they can easily be parsed with abi encoder
 * @param {Object} options Options - not explicitly defined
 */
async function startDebugger(
  sourceDirectory,
  currentFile,
  imports,
  functionSelector,
  argsArray,
  options = {}
) {
  try {
    if (!(await checkInstallations())) return;

    // Remove /c: for wsl mounts / windows
    let mountedDrive = null;
    if (isWsl) {
      mountedDrive = wslMountedDriveRegex.exec(sourceDirectory)?.groups?.drive;
      sourceDirectory = sourceDirectory.replace(`/mnt/${mountedDrive}`, "");
    }
    const cwd = sourceDirectory.replace("/c:", "");

    // Create deterministic deployment address for each contract for the deployed contract
    const config = {
      ...hevmConfig,
      ...options,
      hevmContractAddress: createKeccakHash("keccak256")
        .update(Buffer.from(currentFile))
        .digest("hex")
        .toString("hex")
        .slice(0, 42),
      stateChecked: true,
      mountedDrive,
    };

    // Get calldata
    const calldata = await encodeCalldata(functionSelector, argsArray);

    // Flatten file to prevent the need to file linking -> this will be required for a wasm implementation
    const compilableFile = flattenFile(cwd, currentFile, imports);

    // Compile binary using locally installed compiler - in the future this will be replaced with a wasm compiler
    const bytecode = compileFromFile(
      compilableFile,
      config.tempMacroFilename,
      cwd
    );

    // Get runtime bytecode and run constructor logic
    const runtimeBytecode = deployContract(bytecode, config, cwd);

    runDebugger(runtimeBytecode, calldata, options, config, cwd);
  } catch (e) {
    registerError(
      e,
      "Compilation failed, please contact the team in the huff discord"
    );
    return null;
  }
}

/**Flatten File
 *
 * @param {String} cwd
 * @param {String} currentFile
 * @param {Array<String>} imports declared file imports at the top of the current file
 * @returns
 */
function flattenFile(cwd, currentFile, imports) {
  // Get relative path of files
  const dirPath = currentFile.split("/").slice(0, -1).join("/");

  // Get absolute paths
  const paths = imports.map((importPath) =>
    path.join(
      `${cwd}/${dirPath}`,
      importPath.replace(/#include\s?"/, "").replace('"', "")
    )
  );

  // Read file contents and remove other instances of main
  // main regex
  const mainRegex =
    /#define\s+macro\s+MAIN\s?\((?<args>[^\)]*)\)\s?=\s?takes\s?\((?<takes>[\d])\)\s?returns\s?\((?<returns>[\d])\)\s?{(?<body>[\s\S]*?(?=}))}/gms;
  const files = [
    fs.readFileSync(cwd + "/" + currentFile).toString(),
    ...paths.map((path) => {
      return fs.readFileSync(path).toString().replace(mainRegex, "");
    }),
  ];

  // Flatten and remove imports
  return `${files.join("\n")}`.replace(/#include\s".*"/gm, "");
}

/**Run debugger
 *
 * Craft hevm command and run it in the user terminal
 *
 * @param {String} bytecode
 * @param {String} calldata
 * @param {Object} flags
 * @param {Object} config
 * @param {String} cwd
 */
function runDebugger(bytecode, calldata, flags, config, cwd) {
  console.log("Entering debugger...");

  // Hevm Command
  const hevmCommand = `hevm exec \
  --code ${bytecode} \
  --address ${config.hevmContractAddress} \
  --caller ${config.hevmCaller} \
  --gas 0xffffffff \
  --state ${
    (config.mountedDrive ? "/mnt/" + config.mountedDrive : "") +
    cwd +
    "/" +
    config.statePath
  } \
  --debug \
  ${config.callValueChecked ? "--value " + config.callValue : ""} \
  ${calldata ? "--calldata " + calldata : ""}`;

  // command is cached into a file as execSync has a limit on the command size that it can execute
  writeHevmCommand(hevmCommand, config.tempHevmCommandFilename, cwd);
  const terminalCommand = craftTerminalCommand(cwd, config);
  runInUserTerminal(terminalCommand);
}

/**Prepare Debug Transaction
 *
 * Use abi encoder to encode transaction data
 *
 * @param {String} functionSelector
 * @param {Array<Array<String>} argsObject
 * @returns
 */
async function encodeCalldata(functionSelector, argsObject) {
  console.log("Preparing debugger calldata...");
  try {
    if (argsObject.length == 0) return `0x${functionSelector[0]}`;

    // TODO: error handle with user prompts
    const abiEncoder = new AbiCoder();

    // create interface readable by the abi encoder
    let type = [];
    let value = [];
    argsObject.forEach((arg) => {
      type.push(arg[0]);
      value.push(arg[1]);
    });

    const encoded = abiEncoder.encode(type, value);

    return `0x${functionSelector[0]}${encoded.slice(2, encoded.length)}`;
  } catch (e) {
    registerError(e, `Compilation failed\nSee\n${e}`);
  }
}

module.exports = {
  startDebugger,
  flattenFile,
};
