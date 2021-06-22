// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
const hre = require("hardhat");
const fs = require("fs");
const { ethers } = require("hardhat");
const step2RemoveOutRangeBlocks = require("../outputs/step-2-remove-outrange-blocks.json");
const step3IncludeTotalBnb = require("../outputs/step-3-include-total-bnb-used.json");

const BNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"
const BUSD = "0xe9e7cea3dedca5984780bafc599bd69add087d56"
const GOONG = "0x2afAB709fEAC97e2263BEd78d94aC2951705dB50"
const validBlocks = [8347353, 8347803];

// Reference: https://bscscan.com/tx/0xeee08bfc0aec3c50a8a1daac1aaf7a51405a62440e80eff1281375d97a33e718
const goongPerBnb = 3156.909090909091;
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

  saveToFile(
    "./outputs/step-2-remove-outrange-blocks.json",
    inRangeBlockRecords
  );

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

  console.log(updatedRecord)

  filteredSwapTxWithAmountRecords.push(updatedRecord)
}

  console.log(filteredSwapTxWithAmountRecords)
  saveToFile('./outputs/step-3-filter-swap-tx-with-amount.json', filteredSwapTxWithAmountRecords)
  return filteredSwapTxWithAmountRecords
}

// async function calculateTotalBnbUsed(records) {
//   const includedBnbUsedTxs = [];
//   let totalBnbLost = ethers.BigNumber.from("0");
//   for (record of records) {
//     // for (hash of record.transactions) {
//     const pendingBnb = record.transactions.map((hash) => {
//       return hre.network.provider
//         .send("eth_getTransactionByHash", [hash])
//         .then((tx) => ethers.BigNumber.from(tx.value));
//     });

//     if (pendingBnb.length) {
//       const bnb = await Promise.all(pendingBnb).then(
//         (bnb) => bnb.reduce((acc, tx) => acc.add(tx)),
//         ethers.BigNumber.from("0")
//       );

//       const formattedBnb = ethers.utils.formatEther(bnb);
//       console.log(`User ${record.tg} paid:`, `${formattedBnb} BNB`);

//       totalBnbLost = totalBnbLost.add(ethers.BigNumber.from(bnb));

//       includedBnbUsedTxs.push({
//         ...record,
//         bnb: formattedBnb,
//       });
//     } else {
//       includedBnbUsedTxs.push({ ...record, bnb: "0" });
//     }
//   }

//   saveToFile(
//     "./outputs/step-3-include-total-bnb-used.json",
//     includedBnbUsedTxs
//   );

//   console.log(`Total bnb lost`, ethers.utils.formatEther(totalBnbLost));

//   return includedBnbUsedTxs;
// }

async function calculateGoongCompensate(records, goongPerBnb) {
  let totalCompensateGoong = 0;
  const goongCompensateTxs = records.map((record) => {
    const compensatedGoong = goongPerBnb * parseFloat(record.bnb);

    totalCompensateGoong += compensatedGoong;

    console.log(`${record.bnb} BNB:`, `${compensatedGoong} Goong`);

    return {
      ...record,
      goong: compensatedGoong,
    };
  });

  saveToFile(
    "./outputs/step-4-include-goong-compensate.json",
    goongCompensateTxs
  );
  console.log("Total compensate Goong:", totalCompensateGoong);
}

function saveToFile(filePath, content) {
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
}

// parse(filePath)
//   .then(groupByAddress)
//   .then(removeDuplicatedTxs)
//   .then((records) => removeOutRangeBlocks(records, validBlocks))
//   .then(calculateTotalBnbUsed)
//   .then((records) => calculateGoongCompensate(records, goongPerBnb))
//   .then(() => process.exit(0))
//   .catch((error) => {
//     console.error(error);
//     process.exit(1);
//   });

// calculateTotalBnbUsed(step2RemoveOutRangeBlocks)
filterSwapTxWithAmount(step2RemoveOutRangeBlocks)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
