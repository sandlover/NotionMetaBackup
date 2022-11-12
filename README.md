# NotionMetaBackup



[![npm version](https://badge.fury.io/js/NotionMetaBackup.svg)](https://badge.fury.io/js/NotionMetaBackup)


Notion 数据备份脚本，默认备份数据保存在`files/`下


## Installation

```bash
$ npm i NotionMetaBackup
```

or

```bash
$ yarn add NotionMetaBackup
```

## Start
运行 `index.ts`
```base
$ npm run start
```

## Build
在`dist/`路径下构建js文件，一般来说只需要`npm start`即可
```
$ npm run build
```

## 环境变量
| 变量 | 描述 | 默认值 |
| -- | -- | -- |
| NOTION_TOKEN | notion integration的token | - |
| http_proxy | 代理设置 | - |
| CLIENT_TIMEOUT | notion sdk 超时时间 | 10s |
| LOG_LEVEL | 日志等级 | 'info' |
| TASK_TRY_TIME | 备份任务自动重试次数 | 10 |
| API_RETRY_TIME | API请求失败后等待时间 | 1s |
| TASK_RETRY_TIME | 备份任务失败后等待时间 | 3s |
| SEARCH_TRY_TIME | API请求失败重试次数 | 3 |


## License

**[MIT](LICENSE)** Licensed

---

[Optional footer information here. Maybe thank a friend. Maybe plug your Twitter account. Whatever.]
