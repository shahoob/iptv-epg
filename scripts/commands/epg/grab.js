const { program } = require('commander')
const _ = require('lodash')
const { EPGGrabber, generateXMLTV, Program } = require('epg-grabber')
const { logger: _logger, date, timer, file, parser, api, zip } = require('../../core')
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const { Listr, ListrLogger, ListrLogLevels, ListrDefaultRendererLogLevels, color } = require('listr2')
const CronJob = require('cron').CronJob

dayjs.extend(utc)

const BASE_DIR = process.env.BASE_DIR || '.'
const CURR_DATE = process.env.CURR_DATE || new Date()

program
  .requiredOption('-s, --site <name>', 'Name of the site to parse. Use commas (,) to separate multiple sites without a space in between')
  .option('-l, --lang <code>', 'Filter channels by language (ISO 639-2 code)')
  .option('-o, --output <path>', 'Path to output file. Use commas (,) to separate multiple paths without a space in between. Must be the same order as the site names')
  .option('--cron <expression>', 'Schedule a script run')
  .option('-c, --concurrcncy <value>', 'Number of concurrent tasks', 3)
  .option('--gzip', 'Create a compressed version of the guide as well', false)
  .parse(process.argv)

const options = program.opts()

const sites = options.site.split(',')
options.output = (options.output?.split(',') || null) || sites.map(site => file.resolve(`${BASE_DIR}/guides/{lang}/${site}.xml`))
options.config = sites.map(site => file.resolve(`${BASE_DIR}/sites/${site}/${site}.config.js`))
options.channels = sites.map(site => file.resolve(`${BASE_DIR}/sites/${site}/${site}*.channels.xml`))
// options.concurrency = options.concurrency || 3

let runIndex = 0
const logger = new ListrLogger({
  useIcons: true,
  icon: {
    [ListrDefaultRendererLogLevels.COMPLETED]: 'completed ✔',
    [ListrDefaultRendererLogLevels.FAILED]:    'failed    ✖',
    [ListrDefaultRendererLogLevels.OUTPUT]:    'info      ℹ'
  },
  color: {
    [ListrDefaultRendererLogLevels.OUTPUT]: color.cyan,
    [ListrDefaultRendererLogLevels.FAILED]: color.red,
    [ListrDefaultRendererLogLevels.COMPLETED]: color.green
  }
})

async function main() {
  logger.log(ListrLogLevels.STARTED, 'starting...')

  logger.log(ListrLogLevels.OUTPUT, 'settings:')
  for (let prop in options) {
    logger.log(ListrLogLevels.OUTPUT, `  ${prop}: ${options[prop]}`)
  }

  const configs = await Promise.all(options.config.map(config => loadConfig(config)))
  const queues = await Promise.all(
    options.channels.map((channel, i) => createQueue(channel, configs[i]))
  )

  const sites_queues = _.zip(configs, queues, options.output, sites)

  async function runQueues(sites_queues) {
    if (sites_queues.length > 1) {
      await runJobs(sites_queues)
    } else {
      await runJob(sites_queues[0][0], sites_queues[0][1], sites_queues[0][2])
    }
  }

  if (options.cron) {
    const job = new CronJob(options.cron, function () {
      runQueues(sites_queues)
    })
    job.start()
  } else {
    await runQueues(sites_queues)
  }
}

async function loadConfig(configPath) {
  let config = require(file.resolve(configPath))
  config = _.merge(config, {})
  config.days = config.days || 1

  logger.log(ListrLogLevels.OUTPUT, 'config:')
  logConfig(config)

  return config
}

function logConfig(config, level = 1) {
  let padLeft = '  '.repeat(level)
  for (let prop in config) {
    if (typeof config[prop] === 'string' || typeof config[prop] === 'number') {
      // logger.info(`${padLeft}${prop}: ${config[prop]}`)
      logger.log(ListrLogLevels.OUTPUT, `${padLeft}${prop}: ${config[prop]}`)
    } else if (typeof config[prop] === 'object') {
      level++
      logger.log(ListrLogLevels.OUTPUT, `${padLeft}${prop}:`)
      logConfig(config[prop], level)
    }
  }
}

async function runJobs(sites_queues) {
  /** @type {Listr[]} */
  const jobs = sites_queues.map(([config, queue, outputPath]) => createJob(queue, config, outputPath))

  const listr = new Listr([
    {
      title: 'Batch grab sites',
      task: (ctx, task) => task.newListr(
        sites.map((site, i) => {
          return {
            title: site,
            task: () => jobs[i]
          }
        })
      )
    }
  ], { concurrent: 3 })

  timer.start()
  await listr.run()
  logger.log(ListrLogLevels.COMPLETED, `  done in ${timer.format('HH[h] mm[m] ss[s]')}`)
}

async function runJob(config, queue, outputPath) {
  runIndex++
  logger.log(ListrLogLevels.STARTED, `run #${runIndex}:`)

  const job = createJob(queue, config, outputPath)

  timer.start()

  await job.run()
  
  logger.log(ListrLogLevels.COMPLETED, `  done in ${timer.format('HH[h] mm[m] ss[s]')}`)
}

function createJob(queue, config, outputPath) {
  return new Listr([
    {
      title: 'Grab channels', task: async (ctx, task) => {
        task.title = 'Grabbing channels...'
        const [channels, programs] = await grab(queue, config, task)
        ctx.channels = channels
        ctx.programs = programs
      }
    },
    {
      title: 'Save to XMLTV', task: async (ctx, task) => {
        task.title = 'Saving to XMLTV...'
        await save(outputPath, ctx.channels, ctx.programs, task)
      }
    }
  ], { concurrent: false })
}

async function grab(queue, config, task) {
  const grabber = new EPGGrabber(config)
  const total = queue.length

  task.output = 'Grabbing first channel...'

  const channels = []
  let programs = []

  let i = 1
  for (const item of queue) {
    let channel = item.channel
    let date = item.date
    channels.push(item.channel)
    await grabber
      .grab(channel, date, (data, err) => {
        task.output = `  [${i}/${total}] ${channel.site} (${channel.lang}) - ${channel.xmltv_id} - ${dayjs
          .utc(data.date)
          .format('MMM D, YYYY')} (${data.programs.length} programs)`
        if (i < total) i++

        if (err) {
          logger.log(ListrLogLevels.FAILED, `    ERR: ${err.message}`)
        }
      })
      .then(results => {
        programs = programs.concat(results)
      })
  }

  return [channels, programs]
}

async function createQueue(channelsPath, config) {
  logger.log(ListrLogLevels.OUTPUT, 'creating queue...')
  let queue = {}
  await api.channels.load().catch(logger.error)
  const files = await file.list(channelsPath).catch(logger.error)
  const utcDate = date.getUTC(CURR_DATE)
  for (const filepath of files) {
    logger.log(ListrLogLevels.OUTPUT, `  loading "${filepath}"...`)
    try {
      const { channels } = await parser.parseChannels(filepath)
      const dates = Array.from({ length: config.days }, (_, i) => utcDate.add(i, 'd'))
      for (const channel of channels) {
        if (!channel.site || !channel.xmltv_id) continue
        if (options.lang && channel.lang !== options.lang) continue
        const found = api.channels.find({ id: channel.xmltv_id })
        if (found) {
          channel.logo = found.logo
        }
        for (const d of dates) {
          const dateString = d.toJSON()
          const key = `${channel.site}:${channel.lang}:${channel.xmltv_id}:${dateString}`
          if (!queue[key]) {
            queue[key] = {
              channel,
              date: dateString,
              config,
              error: null
            }
          }
        }
      }
    } catch (err) {
      logger.error(err)
      continue
    }
  }

  queue = Object.values(queue)

  logger.log(ListrLogLevels.COMPLETED, `  added ${queue.length} items`)

  return queue
}

async function save(template, parsedChannels, programs = [], task) {
  const variables = file.templateVariables(template)

  const groups = _.groupBy(parsedChannels, channel => {
    let groupId = ''
    for (let key in channel) {
      if (variables.includes(key)) {
        groupId += channel[key]
      }
    }

    return groupId
  })

  for (let groupId in groups) {
    const channels = groups[groupId]

    let output = {
      channels,
      programs: [],
      date: CURR_DATE
    }

    for (let program of programs) {
      let programLang = program.titles[0].lang
      let channel = channels.find(c => c.xmltv_id === program.channel && c.lang === programLang)
      if (!channel) continue

      output.programs.push(new Program(program, channel))
    }

    output.channels = _.sortBy(output.channels, 'id')
    output.channels = _.uniqBy(output.channels, 'id')

    output.programs = _.sortBy(output.programs, ['channel', 'start'])
    output.programs = _.uniqBy(output.programs, p => p.channel + p.start)

    const outputPath = file.templateFormat(template, output.channels[0])
    const xmlFilepath = outputPath
    const xmltv = generateXMLTV(output)
    task.output = `  saving to "${xmlFilepath}"...`
    await file.create(xmlFilepath, xmltv)

    if (options.gzip) {
      const gzFilepath = `${outputPath}.gz`
      const compressed = await zip.compress(xmltv)
      task.output = `  saving to "${gzFilepath}"...`
      await file.create(gzFilepath, compressed)
    }
  }
}

main()
