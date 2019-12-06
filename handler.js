'use strict';

const log4js = require("log4js");
const moment = require("moment");
const aws = require("aws-sdk");
log4js.configure({
  appenders: { out: { type: 'stdout', layout: { type: 'basic' } } },
  categories: { default: { appenders: ['out'], level: 'info' } },
  replaceConsole: true
});
const logger = log4js.getLogger();


const cloudwatchLogs = new aws.CloudWatchLogs();
const MACKEREL_APIKEY = process.env.MACKEREL_APIKEY;
const logGroupName = process.env.LOG_GROUP;

module.exports.queue = async event => {

  logger.info(`APIKEY = ${MACKEREL_APIKEY}, LOG_GROUP = ${logGroupName}`);
  const now = moment();
  const start = now.subtract(5, "minutes");
  const queryString = `filter @type = "REPORT" |
  parse @message  "Init Duration: * ms" as initDuration |
  filter initDuration > 0 |
  fields @timestamp, @requestId, @billedDuration |
  stats avg(initDuration)
  `;

  await cloudwatchLogs.startQuery({
    startTime: start.unix(),
    endTime: now.unix(),
    queryString,
    logGroupName
  })
  .promise()
  .then(res => logger.info(res))
  .catch(err => logger.error(err))

  return { message: 'Go Serverless v1.0! Your function executed successfully!', event };
};
