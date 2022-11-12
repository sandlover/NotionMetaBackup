import path from 'path';
import fs from 'fs';
import mkdirp from 'mkdirp';
import https from 'https';
import createHttpsProxyAgent from 'https-proxy-agent';
import { Client } from "@notionhq/client"
import {
    PageObjectResponse,
    SearchParameters,
    SearchResponse,
    ClientOptions
} from "./types";


const getDirName = path.dirname;

const proxy = process.env.http_proxy;

const notionToken = process.env.NOTION_TOKEN;

const clientTimeout = +(process.env.CLIENT_TIMEOUT || 0) || 10000;

const defaultTaskTryTime = + (process.env.TASK_TRY_TIME || 0) || 10;
// api-retry waiting time
const API_RETRY_TIME = +(process.env.API_RETRY_TIME || 0) || 1000;
// task-retry waiting time
const TASK_RETRY_TIME = +(process.env.TASK_RETRY_TIME || 0) || 3000;
// max try time for search
const SEARCH_TRY_TIME = process.env.SEARCH_TRY_TIME === undefined ? 3 : +process.env.SEARCH_TRY_TIME;

const DIST_DIR = `../files/${getCurrentDateFormat()}`

const errorFileName = 'error';

async function timeout(ms: number) {
    return new Promise<void>((resolve) => {
        setTimeout(() => {
            resolve()
        }, ms)
    })
}

function getCurrentDateFormat() {
    const date = new Date();
    return [date.getFullYear(), padTo2Digits(date.getMonth() + 1), padTo2Digits(date.getDate())].join('')
        + '_' +
        [
            padTo2Digits(date.getHours()),
            padTo2Digits(date.getMinutes()),
            padTo2Digits(date.getSeconds()),
        ].join('')
}

function padTo2Digits(num: number) {
    return num.toString().padStart(2, '0');
}

let agent: any;
if(proxy) {
    agent =  createHttpsProxyAgent(proxy)
}

type LogLevel = 'info' | 'debug';

class Task {

    client: Client

    level: LogLevel

    tryTime: number

    constructor() {
        const clientOption: ClientOptions = {
            auth: notionToken,
            timeoutMs: clientTimeout,
        };
        if(agent){
            clientOption.agent = agent;
        }
        this.client = new Client(clientOption)

        this.level = process.env.LOG_LEVEL as LogLevel || 'info';
        this.tryTime = defaultTaskTryTime;
    }

    async doSearchAll(options: SearchParameters): Promise<SearchResponse["results"]> {
        const resp = await this.client.search(options);
        if (resp.has_more) {
            this.debug(`load more, cursor: ${resp.next_cursor}`);
            const nextOptions = Object.assign({}, options, {
                start_cursor: resp.next_cursor
            })
            const next = await this.doSearchAll(nextOptions);
            return [...resp.results, ...next];
        } else {
            this.debug('no more search results for options', options)
        }
        return resp.results;
    }

    retryFn(fn: any, times: number, wait: number = API_RETRY_TIME) {
        return async (...args: any[]):Promise<any|Error> => {
            try {
                this.debug(`requesting... `, fn.name, ...args);
                return await fn.apply(this, args)
            } catch (error: any) {
                if (--times < 0) {
                    return error;
                }
                this.info(`wait for ${wait} ms, remain times ${times},`, ...args, error.message);
                await timeout(wait);
                return this.retryFn(fn, times, wait)(...args);
            }
        }
    }

    async search(options: SearchParameters) {
        const results = await this.retryFn(this.doSearchAll, SEARCH_TRY_TIME)(options)
        if (results instanceof Error) {
            throw results
        }
        return results;
    }

    async getPages() {
        const params = {
            filter: {
                value: 'page',
                property: 'object'
            }
        } as const
        const pages = await this.search(params) as PageObjectResponse[];
        const pagesContent = await this.getPagesContent(pages)
        return {
            pages,
            pagesContent
        }
    }

    async getPagesContent(pages: PageObjectResponse[]) {
        const fileMapperPromises = (pages || []).reduce(async (res, page) => {
            const obj = await res
            const id = page.id;
            const result = await this.retryFn(this.blockChildren, SEARCH_TRY_TIME)(id)
            if (result instanceof Error) {
                throw result;
            }
            obj[id] = result;
            return obj;
        }, Promise.resolve({} as any))
        const fileMapper = await fileMapperPromises
        return fileMapper
    }

    getDatabases() {
        const params = {
            filter: {
                value: 'database',
                property: 'object'
            }
        } as const
        return this.search(params)
    }

    async writeFile(path: string, contents: any) {
        let promise = new Promise<void>(async (resolve, reject) => {
            await mkdirp(getDirName(path))
            fs.writeFile(path, contents, (err) => {
                if (err) {
                    return reject(err)
                }
                resolve()
            });
        })
        return promise
    }

    writeJson(filename: string, data: Object) {
        return this.writeFile(path.resolve(__dirname, DIST_DIR, `${filename}.json`), JSON.stringify(data));
    }

    writePageContent(pagesContent: any) {
        return this.writeJson('pagesContent', pagesContent)
    }

    //这里block id可以用page id
    blockChildren(blockId: string) {
        return this.client.blocks.children.list({
            block_id: blockId
        })
    }

    info(...args: any[]): void {
        console.log(`${this.getLocaleTime()} [INFO] `, ...args)
    }

    debug(...args: any[]): void {
        if(this.level === 'debug') {
            console.log(`${this.getLocaleTime()} [DEBUG] `, ...args)
        }
    }

    getLocaleTime() {
        return new Date().toLocaleString();
    }

    printCounts(pages: any[], databases: any[], pagesContent: any) {
        const count = {
            page: pages.length,
            databases: databases.length,
            pageContents: Object.keys(pagesContent).length
        }
        this.info(`downloaded page ${count.page}, databases: ${count.databases}, pageContents: ${count.pageContents}`)
    }

    async download(){
            this.debug(`get pages...`);
            const { pages, pagesContent } = await this.getPages();
            // get databases
            this.debug('get databases...');
            const databases = await this.getDatabases();

            this.debug('writing pages...')
            await this.writeJson('pages', pages);

            this.debug('writing page contents...');
            await this.writePageContent(pagesContent);

            this.debug('writing databases...')
            await this.writeJson('databases', databases)

            this.printCounts(pages, databases, pagesContent);

            this.info('Success')
            process.exit(0);
    }

    async start(): Promise<any> {
        this.info(`Begin backup task`);
        if(proxy){
            this.info(`using proxy ${proxy}`)
        }
        try {
            const result = await this.retryFn(this.download, defaultTaskTryTime, TASK_RETRY_TIME)();
            if (result instanceof Error) {
                throw result;
            }
        } catch (err: any) {
            this.info('task failed err: ', err.message);
            this.writeJson(errorFileName, { err: err.message })
        }
    }
}

const task = new Task()
task.start();