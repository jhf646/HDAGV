快速使用说明

1) 在本地安装依赖：

```bash
cd "d:\宏大立库\AGV\接口测试程序"
npm install
```

2) 启动代理：

```bash
npm start
```

代理默认监听 `http://localhost:3000`，接口路径：`POST /proxy`。

请求体（JSON）：
{
  "url": "http://目标IP:PORT/rcms/services/rest/hikRpcService/agvChargeTask",
  "method": "POST",
  "headers": { "Content-Type": "application/json" },
  "body": "{...}"  // 字符串或对象
}

3) 在 `api-tester.html` 中勾选“使用本地代理”，页面会把请求发送到代理并由代理转发到目标服务器，从而避免浏览器 CORS 限制。

注意：代理将允许任意主机访问（Access-Control-Allow-Origin: *），仅建议在本地测试环境使用，不要在生产环境公开此代理。

4) 告警推送（我们是接口提供方，AGV/调度系统调用）：

- 回调地址：`POST /service/rest/agvCallbackService/warnCallback`
- 请求头：`Content-Type: application/json`
- 请求体示例：

```json
{
  "reqCode": "86A2CBEE1633635E",
  "reqTime": "2023-04-07 09:34:14",
  "data": [
    {
      "agvCode": "9001",
      "beginTime": "2023-04-07 09:29:45",
      "edTime": "",
      "mainCode": "7",
      "mainName": "安全告警",
      "mapCode": "AA",
      "subCode": "7",
      "subName": "急停告警",
      "xPos": "0",
      "yPox": "0"
    }
  ]
}
```

- 成功返回：

```json
{
  "code": "0",
  "message": "成功"
}
```

5) 告警查询接口：

- `GET /api/warn-log?limit=200`
- 用于查看最近告警记录（默认 100，最大 500）
- 页面可直接打开：`warn-status.html?apiHost=http://你的服务IP:3000`