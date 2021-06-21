// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
const hre = require("hardhat");
const fs = require("fs");

async function parse(rawFilePath) {
  const rawText = fs.readFileSync(rawFilePath, "utf-8");
  const jsonText = rawText.replace(/\\/g, "");
  const records = JSON.parse(jsonText);

  return records.map((record) => ({
    ...record,
    transactions: record.transactions.map((tx) => tx.split("/").pop()),
  }));
}

async function groupByAddress(records) {
  const _removedDuplicatedRecords = {};

  for (record of records) {
    _removedDuplicatedRecords[record.address] = {
      ...(_removedDuplicatedRecords[record.address] || record),
      transactions: [
        ...((_removedDuplicatedRecords[record.address] &&
          _removedDuplicatedRecords[record.address]["transactions"]) ||
          []),
        ...record.transactions,
      ],
    };
  }

  const removedDuplicatedRecords = [];

  for (address of Object.keys(_removedDuplicatedRecords)) {
    removedDuplicatedRecords.push(_removedDuplicatedRecords[address]);
  }

  return removedDuplicatedRecords;
}

async function removeDuplicatedTxs(records) {
  const removedDuplicateTxsRecords = records.map((record) => {
    const txSet = new Set(record.transactions);
    return {
      ...record,
      transactions: Array.from(txSet),
    };
  });

  for (record of removedDuplicateTxsRecords) {
    console.log(`User ${record.tg}: `, `${record.transactions.length} txs`);
  }
}

async function removeOutRangeBlocks(records) {}

const filePath = "./inputs/1-129.txt";

parse(filePath)
  .then(groupByAddress)
  .then(removeDuplicatedTxs)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
