// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
const hre = require("hardhat");
const fs = require("fs");
const { ethers } = require("hardhat");

const GOONG = "0x2afAB709fEAC97e2263BEd78d94aC2951705dB50"
const validBlocks = [8347353, 8347803];

// Reference: https://bscscan.com/tx/0xeee08bfc0aec3c50a8a1daac1aaf7a51405a62440e80eff1281375d97a33e718
const goongPerBnb = 3156.909090909091;
const goongPerBusd = 8.695;
const filePath = "./inputs/1-149.txt";

async function parse(rawFilePath) {
  const rawText = fs.readFileSync(rawFilePath, "utf-8");
  const jsonText = rawText.replace(/\\/g, "");
  console.log(jsonText)
  const records = JSON.parse(jsonText);

  return records.map((record) => ({
    ...record,
    transactions: record.transactions.map((tx) => tx.split("/").pop()),
  }));
}

// Step 0: Group transactions from multiple records with the same address
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
  console.log(`Step 0: Completed`)

  return recordsByAddress;
}


// Step 1: Removed duplicated transactions
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

  console.log(`Step 1: Completed`)

  return removedDuplicateTxsRecords;
}

// Step 2: Removed transactions get included outside given blocks
async function removeOutRangeBlocks(records, blocks) {
  const [minBlock, maxBlock] = blocks;
  const inRangeBlockRecords = [];
  let count = 0

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

    const outRangeBlockTxs = await Promise.all(pendingTxs).then((txs) =>
      txs
        .filter(
          (tx) => tx.blockNumber < minBlock || tx.blockNumber > maxBlock
        )
        .map((txs) => txs.hash)
    );

    count++;

    console.log(record)
    console.log(
      `Step 2: Processed ${count}/${records.length}`
    );

    inRangeBlockRecords.push({
      ...record,
      transactions: inRangeBlockTxs,
      rejects: outRangeBlockTxs.map(hash => ({
        hash,
        reason: `The transaction doesn't get included between block ${validBlocks[0]} and block ${validBlocks[1]}`
      }))
    });
  }

  saveToFile(
    "./outputs/step-2-remove-outrange-blocks.json",
    inRangeBlockRecords
  );

  console.log(`Step 2: Completed`)

  return inRangeBlockRecords;
}

async function filterSwapTxWithAmount(records) {
  const bytes4SwapBnbFunc = "0x7ff36ab5"
  const bytes4SwapBnbFeeFunc = "0xb6f9de95"
  const bytes4SwapBusdFunc = "0x38ed1739"
  const swapInterface = new ethers.utils.Interface([
    "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)",
    "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)",
    "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)"
  ])

  const filteredSwapTxWithAmountRecords = []

  let count = 0;
  for(record of records) {
    let bnbUsed = ethers.BigNumber.from("0")
    let busdUsed = ethers.BigNumber.from("0")

    const pendingTxs = record.transactions.map(hash => hre.network.provider
      .send("eth_getTransactionByHash", [hash])
    )
    const txs = await Promise.all(pendingTxs)
    const acceptTxs = []
    const rejectTxs = []

    for(tx of txs) {
      const methodId = ethers.utils.hexDataSlice(tx.input, 0, 4)

      if(methodId === bytes4SwapBnbFunc || methodId == bytes4SwapBnbFeeFunc) {
        const functionName = methodId === bytes4SwapBnbFunc ? "swapExactETHForTokens" : "swapExactETHForTokensSupportingFeeOnTransferTokens"
        const { path } = swapInterface.decodeFunctionData(functionName, tx.input)
        const tokenOut = path[path.length - 1]
        if(tokenOut === GOONG) {
          bnbUsed = bnbUsed.add(tx.value)
          acceptTxs.push(tx.hash)
        }
      } else if(methodId === bytes4SwapBusdFunc) {
        const { amountIn, path } = swapInterface.decodeFunctionData("swapExactTokensForTokens", tx.input)
        const tokenOut = path[path.length - 1]
        if(tokenOut === GOONG) {
          busdUsed = busdUsed.add(amountIn)
          acceptTxs.push(tx.hash)
        }
      } else {
        rejectTxs.push({
          hash: tx.hash,
          reason: "Not swap transaction."
        })
      }
  }

  const updatedRecord = {
    ...record,
    transactions: acceptTxs,
    bnb: ethers.utils.formatEther(bnbUsed),
    busd: ethers.utils.formatEther(busdUsed),
    rejects: [
      ...(record.rejects || []),
      ...rejectTxs
    ],
  }

  count++;

  console.log(
    `Step 3: Processed ${count}/${records.length}`
  );

  filteredSwapTxWithAmountRecords.push(updatedRecord)
}

  console.log(`Step 3: Completed`)
  saveToFile('./outputs/step-3-filter-swap-tx-with-amount.json', filteredSwapTxWithAmountRecords)
  return filteredSwapTxWithAmountRecords
}

async function calculateGoongCompensate(records, goongPerBnb, goongPerBusd) {
  let totalCompensateGoong = 0;
  const goongCompensateTxs = records.map((record) => {
    const compensatedGoongBnb = goongPerBnb * parseFloat(record.bnb);
    const compensatedGoongBusd = goongPerBusd * parseFloat(record.busd);

    totalCompensateGoong += compensatedGoongBnb;
    totalCompensateGoong += compensatedGoongBusd;

    return {
      ...record,
      goongRefund: compensatedGoongBnb + compensatedGoongBusd,
    };
  });

  saveToFile(
    "./outputs/step-4-include-goong-compensate.json",
    goongCompensateTxs
  );

  console.log(`Step 4: Completed`)
  console.log("==============================")
  console.log("Total compensate Goong:", totalCompensateGoong);
}

function saveToFile(filePath, content) {
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
}

parse(filePath)
  .then(groupByAddress)
  .then(removeDuplicatedTxs)
  .then((records) => removeOutRangeBlocks(records, validBlocks))
  .then(filterSwapTxWithAmount)
  .then((records) => calculateGoongCompensate(records, goongPerBnb, goongPerBusd))
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

// filterSwapTxWithAmount(step2RemoveOutRangeBlocks)
//   .then(() => process.exit(0))
//   .catch((error) => {
//     console.error(error);
//     process.exit(1);
//   });
