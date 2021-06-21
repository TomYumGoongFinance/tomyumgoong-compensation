// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
const hre = require("hardhat");
const fs = require("fs");
const { ethers } = require("hardhat");

const validBlocks = [8347353, 8347803];
const filePath = "./inputs/1-129.txt";

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
  const _recordsByAddress = {};

  for (record of records) {
    _recordsByAddress[record.address] = {
      ...(_recordsByAddress[record.address] || record),
      transactions: [
        ...((_recordsByAddress[record.address] &&
          _recordsByAddress[record.address]["transactions"]) ||
          []),
        ...record.transactions.filter((tx) => tx !== ""),
      ],
    };
  }

  const recordsByAddress = [];

  for (address of Object.keys(_recordsByAddress)) {
    recordsByAddress.push(_recordsByAddress[address]);
  }

  saveToFile("./outputs/step-0-group-by-address.json", recordsByAddress);

  return recordsByAddress;
}

async function removeDuplicatedTxs(records) {
  const removedDuplicateTxsRecords = records.map((record) => {
    const txSet = new Set(record.transactions);
    return {
      ...record,
      transactions: Array.from(txSet),
    };
  });

  saveToFile(
    "./outputs/step-1-remove-duplicated-txs.json",
    removedDuplicateTxsRecords
  );

  return removedDuplicateTxsRecords;
}

async function removeOutRangeBlocks(records, blocks) {
  const [minBlock, maxBlock] = blocks;
  const inRangeBlockRecords = [];

  for (record of records) {
    const pendingTxs = record.transactions.map((hash) => {
      return hre.network.provider
        .send("eth_getTransactionByHash", [hash])
        .then((tx) => ({
          hash: tx.hash,
          blockNumber: parseInt(tx.blockNumber),
        }));
    });

    const inRangeBlockTxs = await Promise.all(pendingTxs).then((txs) =>
      txs
        .filter(
          (tx) => tx.blockNumber >= minBlock && tx.blockNumber <= maxBlock
        )
        .map((txs) => txs.hash)
    );

    console.log(
      `User ${record.tg}`,
      `from ${record.transactions.length} txs to ${inRangeBlockTxs.length} txs.`
    );

    inRangeBlockRecords.push({
      ...record,
      transactions: inRangeBlockTxs,
    });
  }

  saveToFile("./outputs/step-2-remove-outrange-blocks.json", inRangeBlockRecords);

  return inRangeBlockRecords;
}

function saveToFile(filePath, content) {
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
}

parse(filePath)
  .then(groupByAddress)
  .then(removeDuplicatedTxs)
  .then((records) => removeOutRangeBlocks(records, validBlocks))
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
