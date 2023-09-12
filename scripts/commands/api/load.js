const { Listr } = require('listr2')
const { mkdir } = require('fs/promises')
const { existsSync, createWriteStream } = require('fs')
const { resolve } = require('path')
const https = require('node:https')

const listr = new Listr([
    {
        title: 'Create temporary folder',
        task: async (ctx, task) => {
            const path = resolve(__dirname, '../../tmp/data')
            if (existsSync(path)) return task.skip('Folder already exists')
            task.title = 'Creating temporary folder...'
            await mkdir(path)
            task.title = 'Created temporary folder'
        }
    },
    {
        title: 'Load data',
        task: async (ctx, task) => task.newListr([
            { title: 'Load channels', task: async () => {
                https.get('https://iptv-org.github.io/api/channels.json', res => {
                    res.pause()
                    const file = createWriteStream(resolve(__dirname, '../../tmp/data/channels.json'), { flags: 'w' })
                    res.pipe(file)
                    res.resume()
                })
            } },
            { title: 'Load countries', task: async () => {
                https.get('https://iptv-org.github.io/api/countries.json', res => {
                    res.pause()
                    const file = createWriteStream(resolve(__dirname, '../../tmp/data/countries.json'), { flags: 'w' })
                    res.pipe(file)
                    res.resume()
                })
            } },
            { title: 'Load regions', task: async () => {
                https.get('https://iptv-org.github.io/api/regions.json', res => {
                    res.pause()
                    const file = createWriteStream(resolve(__dirname, '../../tmp/data/regions.json'), { flags: 'w' })
                    res.pipe(file)
                    res.resume()
                })
            } },
            { title: 'Load subdivisions', task: async () => {
                https.get('https://iptv-org.github.io/api/subdivisions.json', res => {
                    res.pause()
                    const file = createWriteStream(resolve(__dirname, '../../tmp/data/subdivisions.json'), { flags: 'w' })
                    res.pipe(file)
                    res.resume()
                })
            } },
        ], { concurrent: 2 })
    }
], { concurrent: false })

async function load() {
    await listr.run()
}

load()
