import { defineStore } from 'pinia';
import { getMenus } from '@/sql/service';
import { awaitReady } from '@/sql/dbClient';
import { MenuItem } from '@/class';
import { ElMessage } from 'element-plus';


export const useMenuStore = defineStore('menu', {
  state: () => {
    return {
      menus: [] as MenuItem[]
    }
  },
  getters: {

  },
  actions: {
    async fetchMenus() {
      const ready = await awaitReady();
      if (ready.code !== 1) {
        this.menus = [];
        return;
      }
      let res = await getMenus()
      if (res.code != 1) {
        ElMessage.error('菜单获取失败！原因：' + res.msg)
      }
      const menuList: MenuItem[] = res.data || []
      this.menus = menuList
        .filter(menu => !menuList.some(item => item.parentId === menu.menuId))
        .map(menu => {
          const children = menuList.filter(item => item.parentId === menu.menuId)
          return {
            ...menu,
            children: children.length ? children : []
          }
        })

      console.log(this.menus)
    },
  }
});
