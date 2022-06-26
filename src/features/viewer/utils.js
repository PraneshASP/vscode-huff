const vscode = require("vscode");
const commandExists = require("command-exists");
const fs = require("fs");
const {execSync} = require("child_process");

module.exports = {
    deployContract,
    runInUserTerminal,
    compile,
    writeMacro,
    checkHevmInstallation
}

/**Deploy Contract
 * 
 * Deploy the provided contract bytecode to hevm
 * 
 * @param {String} bytecode 
 * @param {Object} config 
 * @param {String} cwd 
 * @param {boolean} macro 
 * @returns 
 */
function deployContract(
    bytecode, 
    config, 
    cwd, 
    macro = false
  ) {
  
      const command = `hevm exec
      --code ${bytecode} \
      --address ${config.hevmContractAddress} \
      --create \
      --caller ${config.hevmCaller} \
      --gas 0xffffffff \
      ${(config.state && !macro)  ? "--state " + cwd + "/" + config.statePath : ""}
      `
      // cache command
      fs.writeFileSync(cwd + "/cache/hevmtemp", command, {cwd});
      
      // execute command
      return execSync("`cat " + cwd + "/cache/hevmtemp`")
}


/**Run in User Terminal
 * 
 * Execute a given command within a new terminal
 * 
 * @param {String} command 
 */
function runInUserTerminal(command){
    const terminal = vscode.window.createTerminal({name: "Huff debug"});
    terminal.sendText(command);
    terminal.show();
  }


  /**Compile
 * 
 * @param {String} sourceDirectory The location in which the users workspace is - where the child processes should be executed
 * @param {String} fileName 
 * @returns 
 */
function compile(sourceDirectory, fileName) {
    console.log("Compiling contract...")
    // TODO: install huffc locally if it doesnt exist and run with npx 

    const command = `npx huffc ${fileName} --bytecode`;
    const bytecode = execSync(command, {cwd: sourceDirectory});
    return `0x${bytecode.toString()}`;
}


/**Write Macro
 * 
 * Write macro into a temporary file location so that it 
 * can be compiled using huffc
 * 
 * @param {String} cwd 
 * @param {String} tempMacroFilename 
 * @param {String} macro 
 */ 
function writeMacro(cwd, tempMacroFilename, macro) {
    fs.writeFileSync(`${cwd}/${tempMacroFilename}.huff`, macro);
}
  

/**Check Hevm Installation
 * 
 * Uses command-exists package to check for hevm installation
 * throw error if not found
 */
async function checkHevmInstallation() {
    try{
        await commandExists("hevm");
        return true;
    } catch (e){
        //TODO: Show something to the user that lets them know that hevm is not installed and
        // that they are required to install it
        
        vscode.window.showErrorMessage(
            "Hevm installation required - install here: https://github.com/dapphub/dapptools#installation"
        )
        return false;
    }
}
