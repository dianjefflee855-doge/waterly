// eslint-disable-next-line @typescript-eslint/no-var-requires
const { contextBridge, ipcRenderer } = require('electron');
const inv = (c: string) => (a?: any) => ipcRenderer.invoke('waterly:' + c, a);
contextBridge.exposeInMainWorld('waterly', {
  state: inv('state'), autoReply: inv('autoReply'), draft: inv('draft'), manualDraft: inv('manualDraft'), edit: inv('edit'),
  discard: inv('discard'), approve: inv('approve'), rule: inv('rule'), llm: inv('llm'), config: inv('config'), setConfig: inv('setConfig'), sendMode: inv('sendMode'), historyDays: inv('historyDays'), lockFallback: inv('lockFallback'), clearHistory: inv('clearHistory'),
  getPermissions: inv('getPermissions'), refreshPermissions: inv('refreshPermissions'), openPermissionPane: inv('openPermissionPane'),
  requestPermission: inv('requestPermission'), dismissPermissions: inv('dismissPermissions'), showPermissionGuide: inv('showPermissionGuide'),
  onPermissionsChanged: (cb: (s: any) => void) => ipcRenderer.on('waterly:permissions', (_: any, s: any) => cb(s)),
  remoteStatus: inv('remoteStatus'), remoteEnable: inv('remoteEnable'), remotePair: inv('remotePair'), remoteRevoke: inv('remoteRevoke'),
  onRemote: (cb: (s: any) => void) => ipcRenderer.on('waterly:remote', (_: any, s: any) => cb(s)),
  onState: (cb: (s: any) => void) => ipcRenderer.on('waterly:state', (_: any, s: any) => cb(s)),
});
