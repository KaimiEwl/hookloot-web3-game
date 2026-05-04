export function createScreenController({
  appScreens,
  state,
  dom,
  saveState,
  onEnterTasks,
  onEnterBoost,
  onEnterShop,
  onEnterWallet,
  onEnterAdmin
}) {
  function setActiveScreen(screen) {
    const allowed = [appScreens.MINER, appScreens.TASKS, appScreens.BOOST, appScreens.SHOP, appScreens.WALLET, appScreens.ADMIN];
    const target = allowed.includes(screen) ? screen : appScreens.MINER;
    if (target !== appScreens.ADMIN) {
      state.ui.screen = target;
    }

    if (dom.minerScreen) {
      const active = target === appScreens.MINER;
      dom.minerScreen.classList.toggle('hidden', !active);
      dom.minerScreen.classList.toggle('is-active', active);
    }
    if (dom.boostScreen) {
      const active = target === appScreens.BOOST;
      dom.boostScreen.classList.toggle('hidden', !active);
      dom.boostScreen.classList.toggle('is-active', active);
    }
    if (dom.tasksScreen) {
      const active = target === appScreens.TASKS;
      dom.tasksScreen.classList.toggle('hidden', !active);
      dom.tasksScreen.classList.toggle('is-active', active);
    }
    if (dom.shopScreen) {
      const active = target === appScreens.SHOP;
      dom.shopScreen.classList.toggle('hidden', !active);
      dom.shopScreen.classList.toggle('is-active', active);
    }
    if (dom.walletScreen) {
      const active = target === appScreens.WALLET;
      dom.walletScreen.classList.toggle('hidden', !active);
      dom.walletScreen.classList.toggle('is-active', active);
    }
    if (dom.adminScreen) {
      const active = target === appScreens.ADMIN;
      dom.adminScreen.classList.toggle('hidden', !active);
      dom.adminScreen.classList.toggle('is-active', active);
    }

    if (dom.navMinerBtn) dom.navMinerBtn.classList.toggle('is-active', target === appScreens.MINER);
    if (dom.navTasksBtn) dom.navTasksBtn.classList.toggle('is-active', target === appScreens.TASKS);
    if (dom.navBoostBtn) dom.navBoostBtn.classList.toggle('is-active', target === appScreens.BOOST);
    if (dom.navShopBtn) dom.navShopBtn.classList.toggle('is-active', target === appScreens.SHOP);
    if (dom.navWalletBtn) dom.navWalletBtn.classList.toggle('is-active', target === appScreens.WALLET);

    if (dom.aiChatWidget) {
      dom.aiChatWidget.classList.remove('in-shop');
      dom.aiChatWidget.classList.toggle('screen-hidden', target === appScreens.TASKS);
    }

    if (target === appScreens.TASKS && typeof onEnterTasks === 'function') {
      onEnterTasks();
    } else if (target === appScreens.BOOST && typeof onEnterBoost === 'function') {
      onEnterBoost();
    } else if (target === appScreens.SHOP && typeof onEnterShop === 'function') {
      onEnterShop();
    } else if (target === appScreens.WALLET && typeof onEnterWallet === 'function') {
      onEnterWallet();
    } else if (target === appScreens.ADMIN && typeof onEnterAdmin === 'function') {
      onEnterAdmin();
    }

    if (target !== appScreens.ADMIN) {
      saveState();
    }
  }

  return { setActiveScreen };
}
