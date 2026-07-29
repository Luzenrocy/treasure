import { runInitOrUpgrade } from '@/sql/initOrUpgrade';
import { awaitReady } from '@/sql/dbClient';
import * as service from '@/sql/platformService';
import { MenuItem, Plugin, Response } from '@/class';

export async function upgrade(): Promise<Response> {
    await runInitOrUpgrade();
    return awaitReady();
}

export async function getMenus(): Promise<Response> {
    const res = await service.getMenus();
    if (res.code === 1) {
        let data: Array<any> = res.data;
        data = data.map(MenuItem.createFrom);
        res.data = data;
    }
    return res;
}

export async function getPlugins(): Promise<Response> {
    const res = await service.getPlugins();
    if (res.code === 1) {
        let data: Array<any> = res.data;
        data = data.map(Plugin.createFrom);
        res.data = data;
    }
    return res;
}

export async function deletePluginByIds(pluginIds: number[]): Promise<Response> {
    return service.batchDeletePlugins(pluginIds);
}

export async function deletePluginById(pluginId: number): Promise<Response> {
    return service.deletePluginById(pluginId);
}

export async function getSettings(): Promise<Response> {
    return service.getAllSettings();
}

export async function saveSetting(settings: any[]): Promise<Response> {
    return service.saveSettings(settings);
}

export async function createDebugPlugin(payload: { pluginCode: string; pluginAlias: string; debugUrl: string; manifest?: any; initScripts?: Record<string, string> }): Promise<Response> {
    return service.createDebugPlugin(payload);
}

export async function updatePluginMenuHidden(pluginId: number, pluginAlias: string, hidden: number): Promise<Response> {
    return service.updatePluginMenuHidden(pluginId, pluginAlias, hidden);
}

export async function getSettingsByPluginCode(pluginCode: string): Promise<Response> {
    return service.getSettingsByPluginCode(pluginCode);
}

export async function saveSettingsByPluginCode(pluginCode: string, settings: any[]): Promise<Response> {
    return service.saveSettingsByPluginCode(pluginCode, settings);
}

export async function isDebugSwitchEnabled(): Promise<boolean> {
    return service.getDebugSwitchEnabled();
}
