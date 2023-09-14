const { Listr, PRESET_TIMER } = require('listr2')
const { mkdir } = require('fs/promises')
const { existsSync, createWriteStream } = require('fs')
const { resolve, join } = require('path')
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
        task: async (ctx, _task) => _task.newListr([
            { title: 'Load channels', task: (ctx, task) => {
                return new Promise((resolve, reject) => {
                    https.get('https://iptv-org.github.io/api/channels.json', res => {
                        res.pause()
                        res.once('close', resolve)
                        const file = createWriteStream(join(ctx.path, 'channels.json'), { flags: 'w' })
                        let downloaded = 0
                        let total = parseInt(res.headers['content-length'], 10)
                        res.on('data', (chunk) => {
                            downloaded += chunk.length
                            task.output = `${(downloaded / total * 100).toFixed(2)}%`
                            file.write(chunk)
                        })
                        res.resume()
                    })
                })
            } },
            { title: 'Load countries', task: (ctx, task) => {
                return new Promise((resolve, reject) => {
                    https.get('https://iptv-org.github.io/api/countries.json', res => {
                        res.pause()
                        res.once('close', resolve)
                        const file = createWriteStream(join(ctx.path, 'countries.json'), { flags: 'w' })
                        let downloaded = 0
                        let total = parseInt(res.headers['content-length'], 10)
                        res.on('data', (chunk) => {
                            downloaded += chunk.length
                            task.output = `${(downloaded / total * 100).toFixed(2)}%`
                            file.write(chunk)
                        })
                        res.resume()
                    })
                })
            } },
            { title: 'Load regions', task: (ctx, task) => {
                return new Promise((resolve, reject) => {
                    https.get('https://iptv-org.github.io/api/regions.json', res => {
                        res.pause()
                        res.once('close', resolve)
                        const file = createWriteStream(join(ctx.path, 'regions.json'), { flags: 'w' })
                        let downloaded = 0
                        let total = parseInt(res.headers['content-length'], 10)
                        res.on('data', (chunk) => {
                            downloaded += chunk.length
                            task.output = `${(downloaded / total * 100).toFixed(2)}%`
                            file.write(chunk)
                        })
                        res.resume()
                    })
                })
            } },
            { title: 'Load subdivisions', task: (ctx, task) => {
                return new Promise((resolve, reject) => {
                    https.get('https://iptv-org.github.io/api/subdivisions.json', res => {
                        res.pause()
                        res.once('close', resolve)
                        const file = createWriteStream(join(ctx.path, 'subdivisions.json'), { flags: 'w' })
                        let downloaded = 0
                        let total = parseInt(res.headers['content-length'], 10)
                        res.on('data', (chunk) => {
                            downloaded += chunk.length
                            task.output = `${(downloaded / total * 100).toFixed(2)}%`
                            file.write(chunk)
                        })
                        res.resume()
                    })
                })
            } },
        ], { ...PRESET_TIMER, concurrent: 2 })
    }
], { concurrent: false })

async function load() {
    console.log(resolve(__dirname, '../../tmp/data/channels.json'))
    await listr.run({
        path: resolve(__dirname, '../../tmp/data')
    })
}

load()
