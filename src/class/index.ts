export class Response {
  code: number;
  msg: string;
  data: any;

  static createFrom(source: any = {}) {
    return new Response(source);
  }
  static ok(data: any) {
    const source = {
      code: 1,
      data: data
    }
    return new Response(source);
  }
  static okMsg(msg: string) {
    const source = {
      code: 1,
      msg: msg
    }
    return new Response(source);
  }
  static error(msg: string) {
    const source = {
      code: 0,
      msg: msg,
    }
    return new Response(source);
  }
  static errorParam(msg: string) {
    return new Response({ code: -1, msg });
  }
  static errorPermission(msg: string) {
    return new Response({ code: -2, msg });
  }
  static errorNotFound(msg: string) {
    return new Response({ code: -3, msg });
  }

  constructor(source: any = {}) {
    if ('string' === typeof source) source = JSON.parse(source);
    this.code = source["code"];
    this.msg = source["msg"];
    this.data = source["data"];
  }
}
export class Count {
  num: number;
  static createFrom(source: any = {}) {
    return new Count(source);
  }

  constructor(source: any = {}) {
    if ('string' === typeof source) source = JSON.parse(source);
    this.num = source["num"];
  }
}
export class MenuItem {
  menuId: string
  menuName: string
  menuType: number
  menuLevel: number
  showType: number
  showOrder: number
  menuPath: string;
  menuIcon: string;
  parentId: string;
  hidden: number;
  pluginType: number;
  debugUrl: string;
  children: MenuItem[];

  static createFrom(source: any = {}) {
    return new MenuItem(source);
  }

  constructor(source: any = {}) {
    if ('string' === typeof source) source = JSON.parse(source);
    this.menuId = source["menuId"] || source["menu_id"];
    this.menuName = source["menuName"] || source["menu_name"];
    this.menuType = source["menuType"] || source["menu_type"];
    this.menuLevel = source["menuLevel"] || source["menu_level"];
    this.parentId = source["parentId"] || source["parent_id"];
    this.menuPath = source["menuPath"] || source["menu_path"];
    this.menuIcon = source["menuIcon"] || source["menu_icon"];
    this.showType = source["showType"] || source["show_type"];
    this.showOrder = source["showOrder"] || source["show_order"];
    this.hidden = source["hidden"];
    this.pluginType = source["pluginType"] ?? source["plugin_type"] ?? 0;
    this.debugUrl = source["debugUrl"] || source["debug_url"] || '';
    this.children = (source["children"] || []).map(MenuItem.createFrom);
  }
}
export class Plugin {
  pluginId: number
  pluginCode: string
  pluginAlias: string
  pluginVersion: string
  pluginDesc: string
  pluginAuthor: string
  pluginIcon: string
  pluginEntry: string
  pluginLocation: string
  hasInitScript: number
  hasDestroyScr: number
  createdAt: Date
  updatedAt: Date
  pluginType: number
  debugUrl: string
  pluginUid: string
  menuHidden: number
  menuIcon: string

  static createFrom(source: any = {}) {
    return new Plugin(source)
  }

  constructor(source: any = {}) {
    if ('string' === typeof source) source = JSON.parse(source);
    this.pluginId = source["id"];
    this.pluginCode = source["pluginCode"] || source["plugin_code"];
    this.pluginAlias = source["pluginAlias"] || source["plugin_alias"];
    this.pluginVersion = source["pluginVersion"] || source["plugin_version"];
    this.pluginDesc = source["pluginDesc"] || source["plugin_desc"] || '';
    this.pluginAuthor = source["pluginAuthor"] || source["plugin_author"] || '';
    this.pluginIcon = source["pluginIcon"] || source["plugin_icon"] || '';
    this.pluginEntry = source["pluginEntry"] || source["plugin_entry"] || '';
    this.pluginLocation = source["pluginLocation"] || source["plugin_location"];
    this.hasInitScript = source["hasInitScript"] ?? source["has_init_script"] ?? 0;
    this.hasDestroyScr = source["hasDestroyScr"] ?? source["has_destroy_scr"] ?? 0;
    this.createdAt = source["createdAt"] || source["created_at"];
    this.updatedAt = source["updatedAt"] || source["updated_at"];
    this.pluginType = source["pluginType"] ?? source["plugin_type"] ?? 0;
    this.debugUrl = source["debugUrl"] || source["debug_url"] || '';
    this.pluginUid = source["pluginUid"] || source["plugin_uid"] || '';
    this.menuHidden = source["menuHidden"] ?? source["menu_hidden"] ?? 0;
    this.menuIcon = source["menuIcon"] || source["menu_icon"] || '';
  }
}

export class AuditLog {
  id: number
  action: string
  entityType: string
  entityId: number | null
  operator: string
  details: string
  ip: string | null
  createdAt: number

  static createFrom(source: any = {}) {
    return new AuditLog(source);
  }

  constructor(source: any = {}) {
    if ('string' === typeof source) source = JSON.parse(source);
    this.id = source["id"];
    this.action = source["action"];
    this.entityType = source["entityType"] || source["entity_type"];
    this.entityId = source["entityId"] || source["entity_id"];
    this.operator = source["operator"];
    this.details = source["details"];
    this.ip = source["ip"];
    this.createdAt = source["createdAt"] || source["created_at"];
  }
}