'use strict';

const moment = require("moment");
const aws = require("aws-sdk");
const shell = require("shelljs");

const log4js = require("log4js");
log4js.configure({
  appenders: { out: { type: 'stdout', layout: { type: 'basic' } } },
  categories: { default: { appenders: ['out'], level: 'info' } },
  replaceConsole: true
});
const logger = log4js.getLogger();

const MACKEREL_APIKEY = process.env.MACKEREL_APIKEY;
const MACKEREL_SERVICE = process.env.MACKEREL_SERVICE;
const DIR = process.env.LAMBDA_TASK_ROOT;
const logGroupNames = process.env.LOG_GROUPS.split(",");

const cloudwatchLogs = new aws.CloudWatchLogs();
const dynamo = new aws.DynamoDB.DocumentClient()

const TableName = "queryTable";

const handleError = (err) => logger.error(err);

const insertDb = async (queryId, now) => {
  const params = {
    TableName,
    Item: {
      queryId,
      createdAt: now.unix()
    }
  };
  dynamo.put(params).promise().catch(handleError)
};

const mkrThrow = (value, epoch) => {
  const command = `echo "custom.lambda.duration.initAvg\t${value}\t${epoch}" | MACKEREL_APIKEY=${MACKEREL_APIKEY} ${DIR}/mkr throw --service ${MACKEREL_SERVICE}`;
  return shell.exec(command);
}

module.exports.queue = async event => {

  const now = moment();
  const start = now.clone().subtract(5, "minutes");
  const queryString = `filter @type = "REPORT" |
  parse @message  "Init Duration: * ms" as initDuration |
  stats avg(initDuration) as avg`;

  const opt = {
    startTime: start.unix(),
    endTime: now.unix(),
    queryString,
    logGroupNames
  };
  const { queryId } = await cloudwatchLogs.startQuery(opt)
  .promise()
  .catch(handleError)

  await insertDb(queryId, now)

  const message = `started queryId: ${queryId}`;
  logger.info(message)
  return { message, event };
};

module.exports.dequeue = async event => {
  const queries = await dynamo.scan({ TableName }).promise().then(res => {
    logger.info(`get ${res.Items.length} records`);
    return res.Items.sort((a, b) => a.createdAt - b.createdAt);
  }).catch(handleError);

  if (queries.length === 0) { return { message: `No recodes.`, event }; }

  const lastQuery = queries.slice(-1)[0];
  await Promise.all(queries.map((q) => dynamo.delete({ TableName, Key: { queryId: q.queryId }}).promise()));

  const result = await cloudwatchLogs.getQueryResults({queryId: lastQuery.queryId}).promise()
    .then((res) => {
      const { status, results } = res;
      logger.info(`${status}: ${lastQuery.queryId}`);
      if (status === "Complete") {
        logger.info(results);
        if (results.length !== 0 && results[0].length !== 0) {
          return mkrThrow(results[0][0].value, lastQuery.createdAt);
        } else {
          return mkrThrow(0, lastQuery.createdAt);
        }
      } if (status === "Scheduled" || status === "Running") {
        // Re-insert to DynamoDB
        insertDb(lastQuery.queryId, lastQuery.createdAt);
      }
    })
    .catch(handleError);

  if (result.code !== 0) {
    logger.error(result.stderr);
  }

  return { message: `compolete processes of ${lastQuery}`, event };
};
