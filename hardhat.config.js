require("@nomiclabs/hardhat-waffle");
const { privateKey, apiKey } = require('./secrets.json')

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async () => {
  const accounts = await ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

module.exports = {
  networks: {
    testnet: {
      url: "https://data-seed-prebsc-1-s1.binance.org:8545",
      chainId: 97,
      gasPrice: 20000000000,
      accounts: [privateKey],
    },
    mainnet: {
      url: "https://bsc-dataseed.binance.org/",
      chainId: 56,
      gasPrice: 5000000000,
      accounts: [privateKey],
    },
    matic: {
      url: "https://rpc-mainnet.maticvigil.com",
      chainId: 137,
      gasPrice: 1000000000,
      accounts: [privateKey],
    },
    hardhat: {
      throwOnTransactionFailures: true,
      throwOnCallFailures: true,
      allowUnlimitedContractSize: true,
    },
  },
  solidity: {
    compilers: [
      {
        version: "0.6.12",
      },
      {
        version: "0.5.16",
      },
      {
        version: "0.5.0",
      },
      {
        version: "0.4.18",
      },
    ],
  },
};
