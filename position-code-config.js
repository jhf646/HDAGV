window.AGV_APP_CONFIG = {
  defaultTargetIp: "192.168.111.70:8182",
  endpoints: [
    {
      id: "genAgvSchedulingTask",
      name: "生成任务单",
      path: "/rcms/services/rest/hikRpcService/genAgvSchedulingTask",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      sample: {
        reqCode: "B0344592BD76C8F",
        taskTyp: "A01",
        positionCodePath: [
          { positionCode: "3001", type: "00" },
          { positionCode: "3002", type: "00" },
        ],
      },
    },
    // {id:'agvChargeTask', name:'小车充电/取消充电', path:'/rcms/services/rest/hikRpcService/agvChargeTask', method:'POST', headers:{'Content-Type':'application/json'}, sample:{"reqCode":"31314","agvCode":"9001","action":"1"}} ,
    // {id:'setPointEmptyState', name:'设置点位有无货架状态', path:'/rcms/services/rest/hikRpcService/setPointEmptyState', method:'POST', headers:{'Content-Type':'application/json'}, sample:{"reqCode":"","positionCode":"A1","emptyState":"1"}} ,
    // {id:'cancelTask', name:'取消任务', path:'/rcms/services/rest/hikRpcService/cancelTask', method:'POST', headers:{'Content-Type':'application/json'}, sample:{"reqCode":"1541954B96B1112","taskCode":"123456","forceCancel":"1"}} ,
    // {id:'continueTask', name:'继续执行任务', path:'/rcms/services/rest/hikRpcService/continueTask', method:'POST', headers:{'Content-Type':'application/json'}, sample:{"reqCode":"73962391d5b5ad","taskCode":"22_721EABDB-B894-4A93-925A-5310E2732940"}} ,
    // {id:'setTaskPriority', name:'设置优先级', path:'/rcms/services/rest/hikRpcService/setTaskPriority', method:'POST', headers:{'Content-Type':'application/json'}, sample:{"reqCode":"B8A4D999457C24A1","priorities":[{"priority":"21","taskCode":"A01_xxx"}]}} ,
    // {id:'agvCallback', name:'任务执行通知（agvCallback）', path:'/wcs/services/rest/cms/agvCallback', method:'POST', headers:{'Content-Type':'application/json'}, sample:{"reqCode":"95C8AA9E154570E7","taskCode":"A01_xxx","method":"start","robotCode":"9001"}} ,
    // {id:'thirdNotifyExcuteRetInfo', name:'外部通知cms任务执行状态', path:'/rcms/services/rest/hikRpcService/thirdNotifyExcuteRetInfo', method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, sample:{des:'1',deviceIndex:'100001',actionStatus:'3',deviceType:'lift',uuid:'123132'}} ,
    // {id:'deviceTask', name:'cms设备任务通知', path:'/wcs/services/rest/cms/deviceTask', method:'POST', headers:{'Content-Type':'application/json'}, sample:{"type":"notifyTask","deviceType":"door","deviceIndex":"1","actionTask":"applyLock","uuid":"DEEA..."}} ,
    {
      id: "queryTaskStatus",
      name: "查询任务状态",
      path: "/rcms/services/rest/hikRpcService/queryTaskStatus",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      sample: { reqCode: "test01", agvCode: "1", taskCodes: [""] },
    },
    {
      id: "queryAgvStatus",
      name: "查询Agv状态",
      path: "/rcms-dps/rest/queryAgvStatus",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      sample: { reqCode: "1", mapShortName: "QQ", robotCount: "-1" },
    },
    // {id:'warnCallback', name:'告警推送', path:'/service/rest/agvCallbackService/warnCallback', method:'POST', headers:{'Content-Type':'application/json'}, sample:{"reqCode":"86A2CBEE1633635E","data":[{"agvCode":"9001","mainCode":"7"}] }} ,
    // {id:'bindPodAndBerth', name:'货架与储位绑定/解绑', path:'/rcms/services/rest/hikRpcService/bindPodAndBerth', method:'POST', headers:{'Content-Type':'application/json'}, sample:{"reqCode":"B0F5C0E5EE0E3C7F","podCode":"111111","positionCode":"022000...","indBind":"1"}} ,
    // {id:'freePod', name:'释放货架', path:'/rcms/services/rest/hikRpcService/freePod', method:'POST', headers:{'Content-Type':'application/json'}, sample:{"reqCode":"test01","mapShortName":"QQ","pods":["100001"],"podCount":"1"}} ,
    // {id:'bindPodAndMat', name:'货架与物料绑定/解绑', path:'/rcms/services/rest/hikRpcService/bindPodAndMat', method:'POST', headers:{'Content-Type':'application/json'}, sample:{"reqCode":"ABAB37A9DDEF87D8","podCode":"111111","materialLot":"2122112","indBind":"1"}} ,
    // {id:'bindCtnrAndTunnel', name:'巷道与容器绑定/解绑', path:'/rcms/services/rest/hikRpcService/bindCtnrAndTunnel', method:'POST', headers:{'Content-Type':'application/json'}, sample:{"reqCode":"test123","tunnelCode":"1","indBind":"1"}} ,
    // {id:'bindCtnrAndBin', name:'仓位与容器绑定/解绑', path:'/rcms/services/rest/hikRpcService/bindCtnrAndBin', method:'POST', headers:{'Content-Type':'application/json'}, sample:{"reqCode":"A722ECCB549DD819","ctnrCode":"122","stgBinCode":"11111101001013","indBind":"1"}} ,
    // {id:'boxApplyPass', name:'料箱取放回调(CTU)', path:'/rcms/services/rest/hikRpcService/boxApplyPass', method:'POST', headers:{'Content-Type':'application/json'}, sample:{"reqCode":"C02_xxx","taskCode":"C02_xxx","eqpType":"cargo","strType":"applyToAgv"}} ,
    // {id:'blockArea', name:'封锁/解封/清空区域', path:'/rcms/services/rest/hikRpcService/blockArea', method:'POST', headers:{'Content-Type':'application/json'}, sample:{"reqCode":"1541954B96B1112","matterArea":"2","indBind":1}}
  ],
  fieldConfig: {
    genAgvSchedulingTask: {
      hiddenFields: ["reqCode"],
      displayNames: {
        taskTyp: "任务编号",
      },
      selectFields: {
        taskTyp: [
          { label: "同楼层搬运任务", value: "A01" },
          { label: "跨楼层搬运任务", value: "A12" },
          //   { label: '跨楼层搬运任务', value: 'A1000' },
        ],
      },
      positionCodePath: {
        hiddenFields: ["type"],
        defaultValues: {
          type: "00",
        },
        // 1，仓库二楼
        // 2，锭子
        // 3，动平衡
        // 4，假捻器
        // 5，二分厂二楼
        positionCode: [
          { label: "二楼仓库1号", value: "5001" },
          { label: "二楼仓库2号", value: "5002" },
          { label: "二楼仓库3号", value: "5003" },
          { label: "二楼仓库4号", value: "5004" },
          { label: "二楼锭子1号", value: "3001" },
          { label: "二楼锭子2号", value: "3002" },
          { label: "二楼锭子3号", value: "3003" },
          { label: "二楼锭子4号", value: "3004" },
          { label: "二楼动平衡1号", value: "4001" },
          { label: "二楼动平衡2号", value: "4002" },
          { label: "二楼动平衡3号", value: "4003" },
          { label: "二楼动平衡4号", value: "4004" },
          { label: "二楼假捻器1号", value: "2001" },
          { label: "二楼假捻器2号", value: "2002" },
          { label: "二楼假捻器3号", value: "2003" },
          { label: "二楼假捻器4号", value: "2004" },
          // { label: '二分厂二楼1号', value: '1001' },
          // { label: '二分厂二楼2号', value: '1002' },
          // { label: '二分厂二楼3号', value: '1003' },
          // { label: '二分厂二楼4号', value: '1004' },
          { label: "二楼纺锭轴承1号", value: "8001" },
          { label: "二楼纺锭轴承2号", value: "8002" },
          { label: "二楼纺锭轴承3号", value: "8003" },
          { label: "二楼纺锭轴承4号", value: "8004" },
          { label: "二楼纺锭轴承5号", value: "8005" },
          { label: "二楼测试点位", value: "6001" },
          { label: "一楼测试点位", value: "10001" },
          { label: "一楼仓库1号", value: "10002" },
          { label: "一楼仓库2号", value: "10003" },
          { label: "一楼生产1号", value: "10004" },
          { label: "一楼生产2号", value: "10005" },
        ],
      },
    },
  },
};
