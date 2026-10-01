<template>
  <div id="header">
    <Menu theme="light" mode="horizontal" @on-select="handleRoute" :active-name="activeMenu" class="oj-menu">
      <div class="logo"><span>{{website.website_name}}</span></div>
      <Menu-item name="/">
        <Icon type="home"></Icon>
        {{$t('m.Home')}}
      </Menu-item>
      <Menu-item name="/problem">
        <Icon type="ios-keypad"></Icon>
        {{$t('m.NavProblems')}}
      </Menu-item>
      <Menu-item name="/contest">
        <Icon type="trophy"></Icon>
        {{$t('m.Contests')}}
      </Menu-item>
      <Menu-item name="/question-bank">
        <Icon type="ios-book"></Icon>
        {{$t('m.Question_Bank')}}
      </Menu-item>
      <!-- 「课程」(/course) 入口暂时隐藏：后端 API 未实现，功能未成熟（2026-09-27） -->
      <Menu-item name="/status">
        <Icon type="ios-pulse-strong"></Icon>
        {{$t('m.NavStatus')}}
      </Menu-item>
      <Submenu name="rank">
        <template slot="title">
          <Icon type="podium"></Icon>
          {{$t('m.Rank')}}
        </template>
        <Menu-item name="/acm-rank">
          {{$t('m.ACM_Rank')}}
        </Menu-item>
        <Menu-item name="/oi-rank">
          {{$t('m.OI_Rank')}}
        </Menu-item>
      </Submenu>
      <Submenu name="about">
        <template slot="title">
          <Icon type="information-circled"></Icon>
          {{$t('m.About')}}
        </template>
        <Menu-item name="/about">
          {{$t('m.Judger')}}
        </Menu-item>
        <Menu-item name="/FAQ">
          {{$t('m.FAQ')}}
        </Menu-item>
      </Submenu>
      <div class="right-menu">
        <template v-if="isAuthenticated">
          <div class="notif-bell" @click="goNotifications">
            <Badge :count="unreadCount" :overflow-count="99">
              <!-- ⚠️ 原来写的是 ios-notifications-outline —— 这个 iView 构建里**没有这个图标**，
                   渲染出来是个空字形 ⇒ 铃铛一直是隐形的。可用的只有 android-notifications(-none/-off) -->
              <Icon type="android-notifications-none" size="22"></Icon>
            </Badge>
          </div>
        </template>
        <template v-if="!isAuthenticated">
          <div class="btn-menu">
            <Button type="ghost"
                    ref="loginBtn"
                    shape="circle"
                    @click="handleBtnClick('login')">{{$t('m.Login')}}
            </Button>
            <Button v-if="website.allow_register"
                    type="ghost"
                    shape="circle"
                    @click="handleBtnClick('register')"
                    style="margin-left: 5px;">{{$t('m.Register')}}
            </Button>
          </div>
        </template>
        <template v-else>
          <Dropdown class="drop-menu" @on-click="handleRoute" placement="bottom" trigger="click">
            <Button type="text" class="drop-menu-title">{{ profile.real_name }}
              <Icon type="arrow-down-b"></Icon>
            </Button>
            <Dropdown-menu slot="list">
              <Dropdown-item name="/user-home">{{$t('m.MyHome')}}</Dropdown-item>
              <Dropdown-item name="/status?myself=1">{{$t('m.MySubmissions')}}</Dropdown-item>
              <Dropdown-item name="/messages">站内信</Dropdown-item>
              <Dropdown-item name="/setting/profile">{{$t('m.Settings')}}</Dropdown-item>
              <Dropdown-item v-if="isAdminRole" name="/admin">{{$t('m.Management')}}</Dropdown-item>
              <Dropdown-item divided name="/logout">{{$t('m.Logout')}}</Dropdown-item>
            </Dropdown-menu>
          </Dropdown>
        </template>
        <!-- 配色切换：放在用户名按钮**右边**（老师要求）。
             三套配色都在容器里（内容哈希缓存），切换＝改浏览器里存的一个词 + 刷新。
             站点用 set_theme.sh 把外观钉死成某一套时，这里整个不显示（以站点为准）。 -->
        <div class="theme-switch" v-if="themeSwitchable" :title="$t('m.Palette')">
          <Dropdown trigger="click" placement="bottom-end" @on-click="changeTheme">
            <span class="theme-trigger"><Icon type="ios-sunny-outline" size="22"></Icon></span>
            <Dropdown-menu slot="list">
              <Dropdown-item name="auto" :selected="themeChoice === 'auto'">{{$t('m.Palette_Auto')}}</Dropdown-item>
              <Dropdown-item name="light" :selected="themeChoice === 'light'">{{$t('m.Palette_Light')}}</Dropdown-item>
              <Dropdown-item name="deep" :selected="themeChoice === 'deep'">{{$t('m.Palette_Deep')}}</Dropdown-item>
              <Dropdown-item name="sand" :selected="themeChoice === 'sand'">{{$t('m.Palette_Sand')}}</Dropdown-item>
            </Dropdown-menu>
          </Dropdown>
        </div>
      </div>
    </Menu>
    <Modal v-model="modalVisible" :width="400">
      <div slot="header" class="modal-title">{{$t('m.Welcome_to')}} {{website.website_name_shortcut}}</div>
      <component :is="modalStatus.mode" v-if="modalVisible"></component>
      <div slot="footer" style="display: none"></div>
    </Modal>
  </div>
</template>

<script>
  import { mapGetters, mapActions } from 'vuex'
  import login from '@oj/views/user/Login'
  import register from '@oj/views/user/Register'

  export default {
    components: {
      login,
      register
    },
    data () {
      // 主题信息由 index.html 里那段内联脚本挂在 window 上（见 build/patch-theme-index.js）：
      //   switchable = 站点档位是 auto（用户可自选）；站点钉死某套时为 false
      //   pick       = 本机存过的选择（没选过是 null → 按"跟随站点"显示）
      let info = {}
      try {
        info = (typeof window !== 'undefined' && window.__OJ_THEME__) || {}
      } catch (e) {
        info = {}
      }
      return {
        themeInfo: info,
        themeChoice: info.pick || 'auto'
      }
    },
    mounted () {
      this.getProfile()
      this.fetchUnreadCount()
      this._notifTimer = setInterval(() => { this.fetchUnreadCount() }, 30000)
    },
    beforeDestroy () {
      if (this._notifTimer) {
        clearInterval(this._notifTimer)
      }
    },
    methods: {
      ...mapActions(['getProfile', 'changeModalStatus', 'fetchUnreadCount']),
      handleRoute (route) {
        if (route === '/messages') {
          window.location.href = '/messages'
        } else if (route && route.indexOf('admin') < 0) {
          this.$router.push(route)
        } else {
          window.open('/admin/')
        }
      },
      handleBtnClick (mode) {
        this.changeModalStatus({
          visible: true,
          mode: mode
        })
      },
      goNotifications () {
        this.$router.push('/notifications')
      },
      changeTheme (name) {
        try {
          window.localStorage.setItem('oj_theme', name)
        } catch (e) {
          // 隐私模式下写不了 localStorage —— 不报错，只是这次选择不被记住
        }
        // 刷新一次：主题是在 <head> 那段脚本里、CSS 加载前定下来的，
        // 而且 Monaco / 代码高亮 / ECharts 是挂载时读色的，只有整页重载才真正一致。
        window.location.reload()
      }
    },
    computed: {
      ...mapGetters(['website', 'modalStatus', 'user', 'profile', 'isAuthenticated', 'isAdminRole', 'unreadCount']),
      // 站点档位是 auto 时才给用户自选（set_theme.sh 把外观钉死某套时不显示这个入口）
      themeSwitchable () {
        return this.themeInfo.switchable === true
      },
      // 跟随路由变化
      activeMenu () {
        return '/' + this.$route.path.split('/')[1]
      },
      modalVisible: {
        get () {
          return this.modalStatus.visible
        },
        set (value) {
          this.changeModalStatus({visible: value})
        }
      }
    }
  }
</script>

<style lang="less" scoped>
  #header {
    min-width: 300px;
    position: fixed;
    top: 0;
    left: 0;
    height: auto;
    width: 100%;
    z-index: 1000;
    background-color: var(--c-bg-card);
    box-shadow: 0 1px 5px 0 rgba(0, 0, 0, 0.1);
    .oj-menu {
      background: var(--c-bg-soft);
    }

    .logo {
      margin-left: 2%;
      margin-right: 2%;
      font-size: 20px;
      float: left;
      line-height: 60px;
    }

    .drop-menu {
      float: right;
      // 右边还有「配色」入口时，间距交给 .right-menu 的 gap 统一管；
      // 没有它（站点把外观钉死了）时，仍按老规矩和右边缘留出距离。
      margin-right: 0;
      &:last-child { margin-right: 30px; }
      &-title {
        font-size: 18px;
      }
    }
    .right-menu {
      position: absolute;
      // 明确贴顶 + 撑满导航条（60px）：这样 align-items:center 才会把每个入口
      // 都对齐到导航栏的正中线上（＝左侧菜单文字那条水平线）。
      // 原来只写了 right:10px —— top 取静态位置、高度取内容高 ⇒ 整块贴顶偏上；
      // 而「配色」还会继承 .ivu-menu-horizontal 的 line-height:60px，
      // 内联块按基线对齐时会被顶到 60px 行框的上半部分 ⇒ 比左边用户名明显高一截。
      top: 0;
      bottom: 0;
      right: 10px;
      display: flex;
      align-items: center;
      gap: 12px;
      line-height: 1; // 断掉 .ivu-menu-horizontal 那条 60px 行高的继承
    }
    .notif-bell {
      cursor: pointer;
      padding: 6px;
      color: var(--c-text-2);
      &:hover { color: var(--c-brand); }
    }
    .theme-switch {
      display: flex; // 自己也是 flex 容器 ⇒ 内部不再走基线对齐
      align-items: center;
      .theme-trigger {
        display: flex; // 图标在 34×34 的方框里严格居中
        align-items: center;
        justify-content: center;
        cursor: pointer;
        padding: 6px;
        color: var(--c-text-2);
        &:hover { color: var(--c-brand); }
      }
    }
    .btn-menu {
      font-size: 16px;
      float: right;
      margin-right: 10px;
    }
  }

  .modal {
    &-title {
      font-size: 18px;
      font-weight: 600;
    }
  }
</style>
