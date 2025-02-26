import * as electron from "electron";
import * as dialogs from "simple-dialogs";
import * as async from "async";

import * as i18n from "../shared/i18n";
import * as settings from "./settings";
import * as splashScreen from "./splashScreen";
import * as updateManager from "./updateManager";
import * as sidebar from "./sidebar";
import * as me from "./sidebar/me";
import * as home from "./home";
import * as serverSettings from "./serverSettings";
import * as serverSettingsSystems from "./serverSettings/systems";
import * as tabs from "./tabs";
import openServerSettings from "./tabs/openServerSettings";
import * as localServer from "./localServer";
import * as chat from "./chat";
import WelcomeDialog from "./WelcomeDialog";

electron.ipcRenderer.on("init", onInitialize);
electron.ipcRenderer.on("quit", onQuit);

const namespaces = [
  "common", "startup",
  "sidebar", "server",
  "welcome", "home"
];

function onInitialize(sender: any, corePath: string, userDataPath: string, languageCode: string) {
  const minimizeButton = document.querySelector(".top .controls button.minimize") as HTMLButtonElement;
  minimizeButton.addEventListener("click", () => { electron.remote.getCurrentWindow().minimize(); });
  const maximizeButton = document.querySelector(".top .controls button.maximize") as HTMLButtonElement;
  maximizeButton.addEventListener("click", () => {
    const window = electron.remote.getCurrentWindow();
    window.isMaximized() ? window.unmaximize() : window.maximize();
  });
  const closeButton = document.querySelector(".top .controls button.close") as HTMLButtonElement;
  closeButton.addEventListener("click", () => { electron.remote.getCurrentWindow().close(); });

  settings.setPaths(corePath, userDataPath);
  i18n.setLanguageCode(languageCode);
  i18n.load(namespaces, () => { settings.load(onSettingsLoaded); });
}

function onQuit() {
  serverSettings.applyScheduledSave();
  settings.applyScheduledSave();

  localServer.shutdown(() => { electron.ipcRenderer.send("ready-to-quit"); });
}

function onSettingsLoaded(err: Error) {
  if (err != null) {
    const label = i18n.t("startup:errors.couldNotLoadSettings", {
      settingsPath: `${settings.userDataPath}/settings.json`,
      reason: err.message
    });
    const options = {
      validationLabel: i18n.t("startup:startAnyway"),
      cancelLabel: i18n.t("common:actions.close")
    };

    new dialogs.ConfirmDialog(label, options, (shouldProceed) => {
      if (!shouldProceed) {
        electron.remote.app.quit();
        return;
      }

      updateManager.checkForUpdates(start);
    });
    return;
  }

  updateManager.checkForUpdates(start);
}

function start() {
  serverSettings.start();
  sidebar.start();
  home.start();

  splashScreen.fadeOut(() => {
    if (settings.nickname == null) {
      async.series([showWelcomeDialog, installFirstSystem]);
    } else {
      me.start();
      chat.start();

      updateSystemsAndPlugins();
    }
  });
}

function showWelcomeDialog(callback: Function) {
  new WelcomeDialog((result) => {
    if (result != null) {
      settings.setNickname(result.nickname);
      settings.setPresence(result.connectToChat ? "online" : "offline");

      settings.setSavedChatrooms(["#superpowers-html5"]);
      if (i18n.languageCode !== "en" && chat.languageChatRooms.indexOf(i18n.languageCode) !== -1) {
        settings.savedChatrooms.push(`#superpowers-html5-${i18n.languageCode}`);
      }
    } else {
      settings.setNickname("Nickname");
      settings.setPresence("offline");
    }

    settings.scheduleSave();

    me.start();
    chat.start();

    setTimeout(callback, 500);
  });
}

function installFirstSystem(callback: Function) {
  const label = i18n.t("welcome:askGameInstall.prompt");
  const options = {
    header: i18n.t("welcome:askGameInstall.title"),
    validationLabel: i18n.t("common:actions.install"),
    cancelLabel: i18n.t("common:actions.skip")
  };

  new dialogs.ConfirmDialog(label, options, (installGame) => {
    if (!installGame) {
      localServer.start();
      callback();
      return;
    }

    const waitingGameInstallElt = document.querySelector(".waiting-game-install") as HTMLDivElement;

    async.series([
      (cb) => {
        openServerSettings();
        serverSettingsSystems.action("install", { systemId: "game" }, () => { cb(); });
        waitingGameInstallElt.hidden = false;
      },
      (cb) => {
        waitingGameInstallElt.hidden = true;

        const label = i18n.t("welcome:serverInformation.info");
        const options = {
          haeder: i18n.t("welcome:serverInformation.title"),
          closeLabel: i18n.t("welcome:serverInformation.gotIt")
        };

        new dialogs.InfoDialog(label, options, cb);
      },
      (cb) => {
        localServer.start();

        const label = i18n.t("welcome:sidebarInformation.info");
        const options = {
          header: i18n.t("welcome:sidebarInformation.title"),
          closeLabel: dialogs.BaseDialog.defaultLabels.close
        };

        new dialogs.InfoDialog(label, options, cb);
      },
      (cb) => {
        const homeTabElt = tabs.tabStrip.tabsRoot.querySelector(`li[data-name="home"]`) as HTMLLIElement;
        tabs.onActivateTab(homeTabElt);

        callback();
      }
    ]);
  });
}

function updateSystemsAndPlugins() {
  serverSettingsSystems.getRegistry((registry) => {
    if (registry == null) { localServer.start(); return; }

    const systemsAndPlugins: string[] = [];
    for (const systemId in registry.systems) {
      const system = registry.systems[systemId];
      if (!system.isLocalDev && system.localVersion != null && system.version !== system.localVersion) systemsAndPlugins.push(systemId);

      for (const authorName in system.plugins) {
        for (const pluginName in system.plugins[authorName]) {
          const plugin = system.plugins[authorName][pluginName];
          if (!plugin.isLocalDev && plugin.localVersion != null && plugin.version !== plugin.localVersion) systemsAndPlugins.push(`${systemId}:${authorName}/${pluginName}`);
        }
      }
    }

    if (systemsAndPlugins.length === 0) { localServer.start(); return; }

    const label = i18n.t("startup:updateAvailable.systemsAndPlugins", { systemsAndPlugins: systemsAndPlugins.join(", ") });
    const options = {
      validationLabel: i18n.t("common:actions.update"),
      cancelLabel: i18n.t("common:actions.skip")
    };

    new dialogs.ConfirmDialog(label, options, (shouldUpdate) => {
      if (shouldUpdate) {
        openServerSettings();
        serverSettingsSystems.updateAll(() => { localServer.start(); });
      } else {
        localServer.start();
      }
    });
  });
}
