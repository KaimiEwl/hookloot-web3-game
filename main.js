import { TonConnectUI } from '@tonconnect/ui';
import {
    APP_EVENTS,
    APP_SCREENS,
    BOOST_QUESTS,
    COIN_BOOST_LEVELS,
    DEFAULT_ACCENTS,
    RARITIES,
    STORAGE_KEYS,
    TON_BOOST_PLANS,
    TON_BALANCE_REFRESH_MS
} from './src/core/constants.js';
import { emitWindowEvent } from './src/core/events.js';
import { getOrCreateReferralCode, buildReferralLink } from './src/core/referral.js';
import { loadAppState, saveAppState } from './src/core/state.js';
import { readString, writeString } from './src/core/storage.js';
import { exposeBridgeOnWindow, registerBridge } from './src/core/bridge.js';
import {
    clearApiAuthSession,
    activateCoinBoost,
    activateInventorySlot,
    activateNftBoost,
    applyReferralCode,
    buyShopItem,
    claimTask,
    createPaymentOrder,
    getAdminAuditLogs,
    getAdminPayment,
    getAdminPaymentOrders,
    getAdminUser,
    getAdminUserLedger,
    getAdminUserReferrals,
    getAdminUserTasks,
    getAdminUsers,
    getAdminWithdrawal,
    getAdminWithdrawals,
    getCurrentUser,
    getGameState,
    getPaymentOrder,
    getPaymentsStatus,
    logoutAuthSession,
    markAdminWithdrawalPaidExternal,
    markAdminWithdrawalUnderReview,
    removeInventorySlot,
    rejectAdminWithdrawal,
    getReferralsMe,
    getTasks,
    requestTonProofPayload,
    syncGameState,
    verifyTelegramWebApp,
    verifyTonProof
} from './src/core/api.js';
import { mapServerActionError, safeDebugLogServerActionError } from './src/core/actionErrors.js';
import {
    applyAuthoritativeGameState,
    formatUnitsForDisplay,
    getProjectedBalanceNumber,
    projectBalanceUnits
} from './src/core/serverState.js';
import { shouldExposeDebugEconomyGlobals } from './src/core/devGuards.js';
import { createBoostController } from './src/modules/boost/controller.js';
import { createAdminController } from './src/modules/admin/controller.js';
import { createScreenController } from './src/modules/miner/screenController.js';
import { createTasksController } from './src/modules/tasks/controller.js';
import { createWalletController } from './src/modules/wallet/controller.js';

const TON_MANIFEST_URL = `${window.location.origin}/tonconnect-manifest.json`;
let state = loadAppState(STORAGE_KEYS.STATE);
const ECONOMY_ACTIONS_ENABLED = false;

function getPublicTelegramOpenUrl() {
    const env = import.meta?.env || {};
    const directUrl = String(env.VITE_PUBLIC_TELEGRAM_MINI_APP_URL || env.VITE_TELEGRAM_MINI_APP_URL || '').trim();
    if (directUrl) return directUrl;
    const username = String(env.VITE_PUBLIC_TELEGRAM_BOT_USERNAME || '').trim().replace(/^@/, '');
    return username ? `https://t.me/${username}` : '';
}

window.RARITIES = RARITIES;
exposeBridgeOnWindow();

function saveState() {
    saveAppState(STORAGE_KEYS.STATE, state);
}

if (shouldExposeDebugEconomyGlobals()) {
    window.getAppRuntimeState = () => structuredClone(state);
}

// DOM Elements
const balanceEl = document.getElementById('balance');
const totalBoostEl = document.getElementById('total-boost-rate');
const insertedCountEl = document.getElementById('inserted-count');
const lanesContainer = document.querySelector('.inventory-lanes');
const slotsContainer = document.getElementById('drop-slots');
const minerHelpBtn = document.getElementById('minerHelpBtn');
const minerScreen = document.getElementById('screenMiner');
const tasksScreen = document.getElementById('screenTasks');
const boostScreen = document.getElementById('screenBoost');
const shopScreen = document.getElementById('screenShop');
const walletScreen = document.getElementById('screenWallet');
const adminScreen = document.getElementById('screenAdmin');
const aiChatWidget = document.getElementById('ai-chat-widget');
const routeConfirmModal = document.getElementById('routeConfirmModal');
const routeConfirmTitle = document.getElementById('routeConfirmTitle');
const routeConfirmText = document.getElementById('routeConfirmText');
const routeConfirmYes = document.getElementById('routeConfirmYes');
const routeConfirmNo = document.getElementById('routeConfirmNo');

const navMinerBtn = document.getElementById('navMinerBtn');
const navTasksBtn = document.getElementById('navTasksBtn');
const navBoostBtn = document.getElementById('navBoostBtn');
const navShopBtn = document.getElementById('openShopBtn');
const navWalletBtn = document.getElementById('navWalletBtn');
const navWalletLabel = document.getElementById('navWalletLabel');

const tasksStatus = document.getElementById('tasksStatus');
const tasksList = document.getElementById('tasksList');
const tasksTelegramPanel = document.getElementById('tasksTelegramPanel');
const tasksTelegramLinkBtn = document.getElementById('tasksTelegramLinkBtn');
const tasksTelegramStatus = document.getElementById('tasksTelegramStatus');
const referralCodeInput = document.getElementById('tasksReferralCode');
const referralCopyBtn = document.getElementById('tasksReferralCopyBtn');
const referralApplyInput = document.getElementById('tasksReferralApplyInput');
const referralApplyBtn = document.getElementById('tasksReferralApplyBtn');
const referralSummary = document.getElementById('tasksReferralSummary');

const adminStatus = document.getElementById('adminStatus');
const adminSearchInput = document.getElementById('adminSearchInput');
const adminRefreshBtn = document.getElementById('adminRefreshBtn');
const adminUsersTable = document.getElementById('adminUsersTable');
const adminUserDetailTable = document.getElementById('adminUserDetailTable');
const adminLedgerTable = document.getElementById('adminLedgerTable');
const adminPaymentsTable = document.getElementById('adminPaymentsTable');
const adminTasksTable = document.getElementById('adminTasksTable');
const adminReferralsTable = document.getElementById('adminReferralsTable');
const adminWithdrawalsTable = document.getElementById('adminWithdrawalsTable');
const adminAuditLogsTable = document.getElementById('adminAuditLogsTable');

const walletStatusText = document.getElementById('walletStatusText');
const walletAddressValue = document.getElementById('walletAddressValue');
const walletTonBalanceValue = document.getElementById('walletTonBalanceValue');
const walletConnectActionBtn = document.getElementById('walletConnectActionBtn');
const walletDisconnectBtn = document.getElementById('walletDisconnectBtn');
const walletCopyAddressBtn = document.getElementById('walletCopyAddressBtn');
const walletReferralInput = document.getElementById('walletReferralInput');
const walletCopyReferralBtn = document.getElementById('walletCopyReferralBtn');
const walletRefreshNftsBtn = document.getElementById('walletRefreshNftsBtn');
const walletNftCount = document.getElementById('walletNftCount');
const walletNftSummary = document.getElementById('walletNftSummary');
const walletNftState = document.getElementById('walletNftState');
const walletNftGrid = document.getElementById('walletNftGrid');
const walletPaymentModeValue = document.getElementById('walletPaymentModeValue');
const walletPaymentStatusValue = document.getElementById('walletPaymentStatusValue');
const shopReceiverInput = document.getElementById('shopReceiverInput');
const shopReceiverSaveBtn = document.getElementById('shopReceiverSaveBtn');
const boostQuestList = document.getElementById('boostQuestList');
const boostCoinList = document.getElementById('boostCoinList');
const boostTonList = document.getElementById('boostTonList');
const boostTotalPerSecEl = document.getElementById('boostTotalPerSec');
const boostCoinPerSecEl = document.getElementById('boostCoinPerSec');
const dailyBoostOrbLayer = document.getElementById('dailyBoostOrbLayer');
const dailyBoostOrb = document.getElementById('dailyBoostOrb');
const dailyBoostOrbCount = document.getElementById('dailyBoostOrbCount');
const dailyBoostOrbProgress = document.getElementById('dailyBoostOrbProgress');
const preloadScreenEl = document.getElementById('preloadScreen');
const preloadSubEl = preloadScreenEl?.querySelector('.preload-sub') || null;
const preloadBarFillEl = preloadScreenEl?.querySelector('.preload-bar span') || null;
const langToggle = document.getElementById('lang-toggle');

const I18N = {
    ru: {
        'preload.loading': '???????? ??????????...',
        'preload.cards': '???????? NFT ????...',
        'preload.almostReady': '????? ??????...',
        'app.title': 'Miner',
        'app.balance': 'BALANCE',
        'miner.nftLanes': 'NFT Lanes',
        'miner.dragHint': '???????? ??? ?????????',
        'miner.dragHelp': '???????? ????? ?? ???????? ???? ? ???? ??? ?? ????????, ????? ???????????? ????.',
        'miner.dropSlots': 'DROP SLOTS',
        'miner.totalInserted': '????? ????????? NFT',
        'miner.activeBoostSlots': '???????? ????-??????',
        'miner.totalBoostTitle': '????? ?????',
        'miner.buyLabel': '??????',
        'miner.boostActiveBadge': '???? ???????',
        'miner.removeBtn': '??????',
        'miner.miningBoostActive': '????',
        'boost.kicker': 'Boost Tasks',
        'boost.title': '?????',
        'boost.subtitle': '???? ???? ? ??????? ?????.',
        'boost.summaryTotal': '????????? ????',
        'boost.summaryCoin': '??????? ????? ?? ??????',
        'boost.detailsTitle': '?????? ??????',
        'boost.tabCoin': '?????? ????',
        'boost.tabCollection': 'NFT BOOST',
        'boost.expandHint': '?????, ????? ??????????',
        'boost.questCollectMore': '?????? ??? {count}',
        'boost.questReadyShort': '??????',
        'boost.questActiveShort': '???????',
        'boost.coinTitleSimple': '???? ????',
        'boost.coinLevelShort': '{level}/10',
        'boost.coinPriceShort': '{cost} ?????',
        'boost.buyBoost': '?????? ????',
        'boost.buyBoostWithCost': '?????? ???? - {cost} ?????',
        'boost.collectionTarget': 'x10: ?????? {target}',
        'boost.statusActive': '???????????',
        'boost.statusInactive': '?? ???????????',
        'boost.buttonActive': 'ACTIVE',
        'boost.buttonActivate': '????????????',
        'boost.buttonCollect': '?????? NFT',
        'boost.statusPurchased': '??????',
        'boost.statusAvailable': '????????',
        'boost.statusLocked': '??????',
        'boost.statusNeedCoins': '????? ?????? ?????',
        'boost.buttonPurchased': '???????',
        'boost.buttonBuyCoins': '??????',
        'boost.buttonNeedCoins': '????? ??????',
        'boost.buttonLocked': '???????',
        'boost.coinCardTitle': '???????? ??????',
        'boost.coinCardHint': '?????? ????, ????? ????????? ????? ???????.',
        'boost.coinCurrentIncome': '??????? ?????',
        'boost.coinNextLevel': '????????? ???????: {level}/10',
        'boost.coinNextIncome': '????????? ?????: +{boost} / SEC',
        'boost.coinCurrentLevel': '??????? ????? {level}/10',
        'boost.coinCurrentTotal': '??????? ???????: {level}/10',
        'boost.coinAllBought': '??? ????????? ???????',
        'boost.coinLevel': '??????? {level}',
        'boost.coinIncome': '+{boost} / SEC ? ???????? ??????',
        'boost.coinCost': '????: {cost}',
        'wallet.kicker': 'TON Wallet',
        'wallet.title': 'Кошелек',
        'wallet.subtitle': 'Подключи TON-кошелек, чтобы видеть баланс, адрес и NFT.',
        'wallet.statusLabel': 'Статус',
        'wallet.balanceLabel': 'Баланс',
        'wallet.addressLabel': 'Адрес',
        'wallet.nftTitle': 'NFT на кошельке',
        'wallet.nftEmpty': 'Подключите кошелек, чтобы увидеть NFT.',
        'wallet.nftEmptyConnected': 'На этом кошельке пока нет NFT.',
        'wallet.nftLoading': 'Загружаю NFT с кошелька...',
        'wallet.nftLoadFailed': 'Не удалось загрузить NFT с кошелька.',
        'wallet.nftUnknownCollection': 'Коллекция',
        'wallet.nftCount': '{count} NFT',
        'wallet.loadingShort': 'Загрузка...',
        'wallet.refresh': 'Обновить',
        'wallet.disconnect': 'Отключить',
        'wallet.shopAddressLabel': 'Адрес магазина',
        'wallet.shopAddressHint': 'TON адрес для оплаты',
        'wallet.save': 'Сохранить',
        'wallet.refLabel': 'Реферальная ссылка',
        'wallet.refHint': 'Поделитесь ссылкой с другом',
        'wallet.copy': 'Копировать',
        'wallet.statusConnected': 'Подключен',
        'wallet.statusDisconnected': 'Не подключен',
        'wallet.notConnected': 'TON кошелек не подключен',
        'wallet.connect': 'Подключить TON',
        'wallet.reconnect': 'Переподключить TON',
        'wallet.toast.loadingConnect': 'TON Connect загружается, попробуйте еще раз',
        'wallet.toast.openFailed': 'Не удалось открыть TON Connect',
        'wallet.toast.disconnected': 'TON кошелек отключен',
        'wallet.toast.unavailable': 'TON Connect сейчас недоступен',
        'wallet.toast.addressCopied': 'Адрес кошелька скопирован',
        'nav.miner': '??????',
        'nav.tasks': 'ЗАДАНИЯ',
        'nav.boost': 'BOOST',
        'nav.shop': '???????',
        'nav.wallet': 'КОШЕЛЕК',
        'tasks.kicker': 'Задания',
        'tasks.title': 'Задания',
        'tasks.subtitle': 'Выполняй задания, получай награды и приглашай друзей.',
        'tasks.telegramTitle': 'Telegram',
        'tasks.telegramText': 'Telegram нужен только для Telegram-заданий. Мы отправляем на сервер только raw initData.',
        'tasks.telegramReady': 'Telegram WebApp найден. Можно привязать Telegram.',
        'tasks.telegramUnavailable': 'Привязка Telegram доступна, когда приложение открыто внутри Telegram.',
        'tasks.telegramOpen': 'Открыть в Telegram',
        'tasks.telegramLink': 'Привязать Telegram',
        'tasks.telegramLinking': 'Привязываем Telegram...',
        'tasks.telegramLinked': 'Telegram привязан',
        'tasks.telegramConnected': 'Telegram подключен',
        'tasks.telegramConnectedShort': 'подключен',
        'tasks.telegramConnectedStatus': 'Telegram подключен: {account}',
        'tasks.listTitle': 'Список заданий',
        'tasks.loading': 'Загружаем задания...',
        'tasks.empty': 'Заданий пока нет. Проверь позже.',
        'tasks.unauthorizedTitle': 'Нужно подключить кошелек',
        'tasks.unauthorizedText': 'Подключи TON-кошелек, чтобы загрузить задания и рефералку.',
        'tasks.claim': 'Получить',
        'tasks.claimed': 'Получено',
        'tasks.claiming': 'Получаем награду...',
        'tasks.claimSuccess': 'Награда получена',
        'tasks.reward': 'Награда',
        'tasks.rewardUnit': 'монет',
        'tasks.status.not_started': 'не начато',
        'tasks.status.ready_to_claim': 'готово',
        'tasks.status.claimed': 'получено',
        'tasks.status.blocked': 'заблокировано',
        'tasks.status.needs_action': 'нужно действие',
        'tasks.status.needs_telegram': 'нужен Telegram',
        'tasks.status.not_configured': 'не настроено',
        'tasks.status.verification_unavailable': 'проверка недоступна',
        'tasks.status.retryable_error': 'можно повторить',
        'tasks.connectTelegramFirst': 'Подключить Telegram',
        'tasks.retry': 'Повторить',
        'tasks.reason.telegramFirst': 'Сначала подключите Telegram.',
        'tasks.reason.notConfigured': 'Задание на подписку пока не настроено.',
        'tasks.reason.verificationUnavailable': 'Проверка Telegram временно недоступна.',
        'tasks.reason.retryable': 'Проверка временно не прошла. Попробуйте еще раз.',
        'tasks.reason.telegramSubscribe': 'Подпишитесь на Telegram-канал, затем получите награду.',
        'tasks.reason.nftMissing': 'Сначала нужна подходящая NFT.',
        'tasks.refTitle': 'Рефералы',
        'tasks.refCode': 'Мой код',
        'tasks.refCopy': 'Копировать',
        'tasks.refApplyPlaceholder': 'Реферальный код',
        'tasks.refApply': 'Применить',
        'tasks.refNote': 'Self-referral запрещен. Код можно применить только для другого пользователя.',
        'tasks.refNoCode': 'Код еще не создан',
        'tasks.refInvites': 'Приглашения',
        'tasks.refFriend': 'Друг',
        'tasks.refCopied': 'Реферальный код скопирован',
        'tasks.refEnterCode': 'Введите реферальный код.',
        'tasks.refApplying': 'Применяем реферальный код...',
        'tasks.refApplied': 'Реферальный код применен',
        'tasks.refSelfError': 'Self-referral запрещен.',
        'tasks.refAlreadyUsed': 'Referral code уже использован.',
        'tasks.refInvalid': 'Неверный referral code.',
        'tasks.errorUnauthorized': 'Сначала подключи TON-кошелек.',
        'tasks.errorAlreadyClaimed': 'Задание уже получено.',
        'tasks.errorCondition': 'Условие задания еще не выполнено.',
        'tasks.errorGeneric': 'Действие не выполнено. Попробуй еще раз.',
        'tasks.offline': 'Сервер временно недоступен. Проверь подключение и повтори попытку.',
        'tasks.offlineTitle': 'Сервер недоступен',
        'tasks.offlineRetry': 'Повторить',
        'errors.insufficientBalance': 'Недостаточно монет.',
        'errors.nftRequired': 'Нужна подходящая NFT. Купи NFT или подключи кошелек с NFT.',
        'errors.maxLevel': 'Максимальный уровень уже достигнут.',
        'errors.invalidSlot': 'Этот NFT-слот недоступен.',
        'errors.itemNotFound': 'Этот предмет сейчас недоступен.',
        'errors.alreadyClaimed': 'Награда уже получена.',
        'errors.taskNotCompleted': 'Задание еще не выполнено.',
        'errors.referralInvalid': 'Неверный реферальный код.',
        'errors.referralSelf': 'Нельзя использовать свой реферальный код.',
        'errors.referralAlreadyUsed': 'Реферальный код уже использован.',
        'errors.paymentReceiverNotConfigured': 'Прием платежей пока не настроен.',
        'errors.paymentOrderExpired': 'Счет на оплату истек. Создай новый.',
        'errors.unauthorized': 'Сначала подключи TON-кошелек.',
        'errors.rateLimited': 'Слишком много попыток. Попробуй позже.',
        'errors.validationError': 'Проверь данные и попробуй еще раз.',
        'errors.serverError': 'Ошибка сервера. Попробуй еще раз.',
        'server.loadingTitle': 'Синхронизация',
        'server.loadingBody': 'Загружаем баланс, NFT и задания с сервера...',
        'server.authTitle': 'Подключите кошелек',
        'server.authBody': 'Подключите TON wallet, чтобы сервер загрузил ваш аккаунт.',
        'server.offlineTitle': 'Сервер недоступен',
        'server.offlineBody': 'Локальная экономика отключена. Данные появятся после восстановления API.',
        'server.retry': 'Повторить',
        'server.syncFailed': 'Серверная синхронизация не выполнена',
        'chat.placeholder': '?????? AI...',
        'chat.title': 'AI helper',
        'chat.greeting': '??????! ? AI ???????? ???????. ??? ???????',
        'chat.kbUnavailable': '???? ?????? ??????????. ?????????? ?????.',
        'chat.send': '?????????',
        'toast.refLinkCopied': '??????????? ?????? ???????????',
        'toast.shopReceiverSaved': '????? ???????? ????????',
        'toast.shopReceiverCleared': '????? ???????? ??????',
        'toast.tapCardToInsert': '????? ?? ?????, ????? ???????? NFT',
        'toast.collectRequiredCards': '??????? ?????? {count} ???? {rarity}',
        'toast.collectionBoostActivated': 'Буст за коллекцию активирован: +{boost} / час',
        'toast.coinBoostMaxed': '??? ????????? ?? ?????? ??? ???????',
        'toast.notEnoughCoins': '???????????? ?????',
        'toast.coinBoostBought': 'Улучшение {level}/10 куплено: +{boost} / час',
        'toast.dailyBoostProgress': '?????: {count}/5',
        'toast.dailyBoostActivated': '?????????? ???? ???????????: x2 ?? 1 ???',
        'toast.dailyBoostCooldown': '????? ???????? ??????',
        'toast.nftBoostMaxed': 'NFT буст уже на максимальном уровне',
        'boost.dailyRewardLabel': 'x2 ? 1 ???',
        'shop.boostLine': '????: +{boost} / SEC',
        'shop.boostMultiplier': 'x{multiplier} ?? ????? ??????',
        'shop.buyBtn': '?????? - {cost} ?????',
        'shop.goConfirm': '??????? ? ???????, ????? ?????? {name} ?? {cost} ??????',
        'boost.incomeUnit': 'доход',
        'boost.popupNoNftTitle': 'Нет NFT',
        'boost.popupNoNftBody': 'У вас нет NFT. Купите NFT, чтобы активировать буст. Перейти в магазин?',
        'boost.popupNeedMoreBody': 'Чтобы улучшить, у вас должно быть {required}/10 NFT. Сейчас {progress}/10. Нужно еще {needed}. Перейти в магазин?',
        'boost.nftBuyAction': 'Купить +{boost} /hour',
        'boost.nftActivateAction': 'Активировать +{boost} /hour',
        'boost.nftNeedHint': 'Чтобы улучшить: нужно {required}/10 NFT',
        'boost.nftProgressLabel': 'Готово: {owned}/{required} NFT',
        'boost.nftTotalLabel': 'Всего +{boost} /hour',
        'boost.nftMaxLabel': 'Активирован',
        'boost.nftBuyLabel': 'Купить буст',
        'boost.nftNeedLabel': 'Нужно NFT',
        'boost.nftActiveLabel': 'Активирован: {count}/10',
        'boost.popupGoShop': 'В магазин',
        'boost.popupCancel': 'Отмена',
        'boost.popupActivatedTitle': 'Буст активирован',
        'boost.popupActivatedBody': '+{boost} / час',
        'boost.popupOk': 'ОК',
        'app.confirmTitle': '??????????? ????????',
        'shop.title': 'NFT ???????',
        'shop.boostDefault': '????: +0.00 / SEC',
        'shop.buyDefault': '??????',
        'shop.confirmDefaultTitle': '??????????? ????????',
        'shop.confirmDefaultCost': '...',
        'shop.confirmYes': '??',
        'shop.confirmNo': '???',
        'shop.confirm.title': '?????? {name}?',
        'shop.confirm.cost': '????: {cost} ?????',
        'shop.confirm.wait': '???????? NFT...',
        'shop.toast.connectWallet': '??????? ???????? ???????',
        'shop.toast.setReceiver': '????? ????? ?????????? ? ????????',
        'shop.toast.notEnoughTon': '???????????? ?????',
        'shop.toast.purchased': '{name} ??????',
        'shop.toast.rejected': '?????????? ?????????',
        'shop.toast.failed': '??????? ?? ??????'
    },
    en: {
        'preload.loading': 'Loading interface...',
        'preload.cards': 'Loading NFT cards...',
        'preload.almostReady': 'Almost ready...',
        'app.title': 'Miner',
        'app.balance': 'BALANCE',
        'miner.nftLanes': 'NFT Lanes',
        'miner.dragHint': 'Drag to activate',
        'miner.dragHelp': 'Drag card from top lane to same-rarity slot below to activate boost.',
        'miner.dropSlots': 'DROP SLOTS',
        'miner.totalInserted': 'Total inserted NFT',
        'miner.activeBoostSlots': 'Active boost slots',
        'miner.totalBoostTitle': 'TOTAL MINING RATE',
        'miner.buyLabel': 'Buy',
        'miner.boostActiveBadge': 'BOOST ACTIVE',
        'miner.removeBtn': 'Remove',
        'miner.miningBoostActive': 'Boost',
        'boost.kicker': 'Boost Tasks',
        'boost.title': 'Boosts',
        'boost.subtitle': 'Buy a boost to increase income.',
        'boost.summaryTotal': 'Total boost',
        'boost.summaryCoin': 'Base income from coins',
        'boost.detailsTitle': 'Boost details',
        'boost.tabCoin': 'Buy boost',
        'boost.tabCollection': 'NFT BOOST',
        'boost.expandHint': 'Tap to expand',
        'boost.questCollectMore': 'Collect {count} more',
        'boost.questReadyShort': 'Ready',
        'boost.questActiveShort': 'Active',
        'boost.questGet': 'Get {count} {rarity} NFT',
        'boost.questRewardHour': 'Reward +{reward} per hour',
        'boost.questNow': 'Now {current}/{target}',
        'boost.coinTitleSimple': 'Buy boost',
        'boost.coinLevelShort': '{level}/10',
        'boost.coinPriceShort': '{cost} coins',
        'boost.buyBoost': 'Buy boost',
        'boost.buyBoostWithCost': 'Buy boost - {cost} coins',
        'boost.collectionTarget': 'x10: collect {target}',
        'boost.statusActive': 'Active',
        'boost.statusInactive': 'Inactive',
        'boost.buttonActive': 'ACTIVE',
        'boost.buttonActivate': 'ACTIVATE',
        'boost.buttonCollect': 'COLLECT',
        'boost.statusPurchased': 'Purchased',
        'boost.statusAvailable': 'Available',
        'boost.statusLocked': 'Locked',
        'boost.statusNeedCoins': 'Need more coins',
        'boost.buttonPurchased': 'PURCHASED',
        'boost.buttonBuyCoins': 'BUY',
        'boost.buttonNeedCoins': 'NEED COINS',
        'boost.buttonLocked': 'LOCKED',
        'boost.coinCardTitle': 'Income upgrade',
        'boost.coinCardHint': 'Buy boost to increase miner income.',
        'boost.coinCurrentIncome': 'Current income',
        'boost.coinNextLevel': 'Next level: {level}/10',
        'boost.coinNextIncome': 'Next bonus: +{boost} / SEC',
        'boost.coinCurrentLevel': 'Boost level {level}/10',
        'boost.coinCurrentTotal': 'Current level: {level}/10',
        'boost.coinAllBought': 'All upgrades purchased',
        'boost.coinLevel': 'Level {level}',
        'boost.coinIncome': '+{boost} / SEC to base income',
        'boost.coinCost': 'Cost: {cost}',
        'wallet.kicker': 'TON Wallet',
        'wallet.title': 'Wallet',
        'wallet.subtitle': 'Connect TON wallet to see balance, address and NFTs.',
        'wallet.statusLabel': 'Status',
        'wallet.balanceLabel': 'Balance',
        'wallet.addressLabel': 'Address',
        'wallet.nftTitle': 'NFT on wallet',
        'wallet.nftEmpty': 'Connect wallet to see NFTs.',
        'wallet.nftEmptyConnected': 'No NFTs found on this wallet yet.',
        'wallet.nftLoading': 'Loading wallet NFTs...',
        'wallet.nftLoadFailed': 'Failed to load wallet NFTs.',
        'wallet.nftUnknownCollection': 'Collection',
        'wallet.nftCount': '{count} NFT',
        'wallet.loadingShort': 'Loading...',
        'wallet.refresh': 'Refresh',
        'wallet.disconnect': 'Disconnect',
        'wallet.shopAddressLabel': 'Shop address',
        'wallet.shopAddressHint': 'TON payment receiver',
        'wallet.save': 'Save',
        'wallet.refLabel': 'Referral',
        'wallet.refHint': '+ bonus for a friend',
        'wallet.copy': 'Copy',
        'wallet.statusConnected': 'Connected',
        'wallet.statusDisconnected': 'Not connected',
        'wallet.notConnected': 'TON wallet not connected',
        'wallet.connect': 'Connect TON',
        'wallet.reconnect': 'Reconnect TON',
        'wallet.toast.loadingConnect': 'TON Connect is loading, try again',
        'wallet.toast.openFailed': 'Failed to open TON Connect',
        'wallet.toast.disconnected': 'TON wallet disconnected',
        'wallet.toast.unavailable': 'TON Connect is currently unavailable',
        'wallet.toast.addressCopied': 'Wallet address copied',
        'nav.miner': 'MINER',
        'nav.tasks': 'TASKS',
        'nav.boost': 'BOOST',
        'nav.shop': 'SHOP',
        'nav.wallet': 'WALLET',
        'tasks.kicker': 'Tasks',
        'tasks.title': 'Tasks',
        'tasks.subtitle': 'Complete tasks, claim rewards and invite friends.',
        'tasks.telegramTitle': 'Telegram',
        'tasks.telegramText': 'Telegram is only needed for Telegram tasks. The app sends raw initData to the server.',
        'tasks.telegramReady': 'Telegram WebApp detected. You can link Telegram.',
        'tasks.telegramUnavailable': 'Telegram linking is available when opening the app from Telegram.',
        'tasks.telegramOpen': 'Open in Telegram',
        'tasks.telegramLink': 'Link Telegram',
        'tasks.telegramLinking': 'Linking Telegram...',
        'tasks.telegramLinked': 'Telegram linked',
        'tasks.telegramConnected': 'Telegram connected',
        'tasks.telegramConnectedShort': 'connected',
        'tasks.telegramConnectedStatus': 'Telegram connected: {account}',
        'tasks.listTitle': 'Task list',
        'tasks.loading': 'Loading tasks...',
        'tasks.empty': 'No tasks yet. Check back soon.',
        'tasks.unauthorizedTitle': 'Wallet required',
        'tasks.unauthorizedText': 'Connect TON wallet to load tasks and referrals.',
        'tasks.claim': 'Claim',
        'tasks.claimed': 'Claimed',
        'tasks.claiming': 'Claiming reward...',
        'tasks.claimSuccess': 'Task reward claimed',
        'tasks.reward': 'Reward',
        'tasks.rewardUnit': 'coins',
        'tasks.status.not_started': 'not started',
        'tasks.status.ready_to_claim': 'ready to claim',
        'tasks.status.claimed': 'claimed',
        'tasks.status.blocked': 'blocked',
        'tasks.status.needs_action': 'needs action',
        'tasks.status.needs_telegram': 'needs Telegram',
        'tasks.status.not_configured': 'not configured',
        'tasks.status.verification_unavailable': 'verification unavailable',
        'tasks.status.retryable_error': 'retry available',
        'tasks.connectTelegramFirst': 'Connect Telegram',
        'tasks.retry': 'Retry',
        'tasks.reason.telegramFirst': 'Connect Telegram first.',
        'tasks.reason.notConfigured': 'Subscription task is not configured yet.',
        'tasks.reason.verificationUnavailable': 'Telegram verification is temporarily unavailable.',
        'tasks.reason.retryable': 'Verification failed temporarily. Try again.',
        'tasks.reason.telegramSubscribe': 'Subscribe to the Telegram channel, then claim.',
        'tasks.reason.nftMissing': 'Own the required NFT first.',
        'tasks.refTitle': 'Referral',
        'tasks.refCode': 'My code',
        'tasks.refCopy': 'Copy',
        'tasks.refApplyPlaceholder': 'Referral code',
        'tasks.refApply': 'Apply',
        'tasks.refNote': 'Self-referral is not allowed. Apply a code only from another user.',
        'tasks.refNoCode': 'No code yet',
        'tasks.refInvites': 'Invites',
        'tasks.refFriend': 'Friend',
        'tasks.refCopied': 'Referral code copied',
        'tasks.refEnterCode': 'Enter referral code.',
        'tasks.refApplying': 'Applying referral code...',
        'tasks.refApplied': 'Referral code applied',
        'tasks.refSelfError': 'Self-referral is not allowed.',
        'tasks.refAlreadyUsed': 'Referral code is already used.',
        'tasks.refInvalid': 'Invalid referral code.',
        'tasks.errorUnauthorized': 'Connect TON wallet first.',
        'tasks.errorAlreadyClaimed': 'Task is already claimed.',
        'tasks.errorCondition': 'Task condition is not completed yet.',
        'tasks.errorGeneric': 'Action failed. Try again.',
        'tasks.offline': 'Server is unavailable. Check the connection and retry.',
        'tasks.offlineTitle': 'Server unavailable',
        'tasks.offlineRetry': 'Retry',
        'errors.insufficientBalance': 'Not enough coins.',
        'errors.nftRequired': 'Required NFT is missing. Buy NFT or connect a wallet with NFT.',
        'errors.maxLevel': 'Maximum level is already reached.',
        'errors.invalidSlot': 'This NFT slot is unavailable.',
        'errors.itemNotFound': 'This item is not available.',
        'errors.alreadyClaimed': 'Reward is already claimed.',
        'errors.taskNotCompleted': 'Task is not completed yet.',
        'errors.referralInvalid': 'Invalid referral code.',
        'errors.referralSelf': 'Self-referral is not allowed.',
        'errors.referralAlreadyUsed': 'Referral code is already used.',
        'errors.paymentReceiverNotConfigured': 'Payment receiver is not configured yet.',
        'errors.paymentOrderExpired': 'Payment order expired. Create a new one.',
        'errors.unauthorized': 'Connect TON wallet first.',
        'errors.rateLimited': 'Too many attempts. Try again later.',
        'errors.validationError': 'Check the entered data and try again.',
        'errors.serverError': 'Server error. Try again.',
        'server.loadingTitle': 'Syncing server state',
        'server.loadingBody': 'Loading authoritative balance, NFT and task state...',
        'server.authTitle': 'Connect wallet to sync',
        'server.authBody': 'Connect TON wallet so the server can load your account.',
        'server.offlineTitle': 'Server unavailable',
        'server.offlineBody': 'Local economy is disabled until the API is available.',
        'server.retry': 'Retry',
        'server.syncFailed': 'Server sync failed',
        'chat.placeholder': 'Ask AI...',
        'chat.title': 'AI helper',
        'chat.greeting': 'Hi! I am your miner AI assistant. How can I help?',
        'chat.kbUnavailable': 'Knowledge base is unavailable. Please try again later.',
        'chat.send': 'Send',
        'toast.refLinkCopied': 'Referral link copied',
        'toast.shopReceiverSaved': 'Shop receiver saved',
        'toast.shopReceiverCleared': 'Shop receiver cleared',
        'toast.tapCardToInsert': 'Tap or click card to insert NFT',
        'toast.collectRequiredCards': 'Collect {count} {rarity} cards first',
        'toast.collectionBoostActivated': 'Collection boost activated: +{boost} / HOUR',
        'toast.coinBoostMaxed': 'All coin upgrades are already purchased',
        'toast.notEnoughCoins': 'Not enough coins',
        'toast.coinBoostBought': 'Upgrade {level}/10 purchased: +{boost} / HOUR',
        'toast.dailyBoostProgress': 'Orb: {count}/5',
        'toast.dailyBoostActivated': 'Daily boost activated: x2 for 1 hour',
        'toast.dailyBoostCooldown': 'Orb returns tomorrow',
        'toast.nftBoostMaxed': 'NFT boost is already max level',
        'boost.dailyRewardLabel': 'x2 • 1 hour',
        'shop.boostLine': 'Boost: +{boost} / SEC',
        'shop.boostMultiplier': 'x{multiplier} to all income',
        'shop.buyBtn': 'BUY - {cost} COINS',
        'shop.goConfirm': 'Go to shop to buy {name} for {cost} coins?',
        'boost.incomeUnit': 'income',
        'boost.popupNoNftTitle': 'No NFT',
        'boost.popupNoNftBody': 'You have no NFT. Buy NFT to activate boost. Go to shop?',
        'boost.popupNeedMoreBody': 'To upgrade, you need {required}/10 NFT. Current: {progress}/10. Need {needed} more. Go to shop?',
        'boost.nftBuyAction': 'Buy +{boost} /hour',
        'boost.nftActivateAction': 'Activate +{boost} /hour',
        'boost.nftNeedHint': 'To upgrade: need {required}/10 NFT',
        'boost.nftProgressLabel': 'Ready: {owned}/{required} NFT',
        'boost.nftTotalLabel': 'Total +{boost} /hour',
        'boost.nftMaxLabel': 'Activated',
        'boost.nftBuyLabel': 'Buy boost',
        'boost.nftNeedLabel': 'Need NFT',
        'boost.nftActiveLabel': 'Activated: {count}/10',
        'boost.popupGoShop': 'Go shop',
        'boost.popupCancel': 'Cancel',
        'boost.popupActivatedTitle': 'Boost activated',
        'boost.popupActivatedBody': '+{boost} / hour',
        'boost.popupOk': 'OK',
        'app.confirmTitle': 'Confirm action',
        'shop.title': 'NFT SHOP',
        'shop.boostDefault': 'Boost: +0.00 / SEC',
        'shop.buyDefault': 'BUY',
        'shop.confirmDefaultTitle': 'Confirm purchase?',
        'shop.confirmDefaultCost': '...',
        'shop.confirmYes': 'YES',
        'shop.confirmNo': 'NO',
        'shop.confirm.title': 'Buy {name}?',
        'shop.confirm.cost': 'Cost: {cost} coins',
        'shop.confirm.wait': 'Buying NFT...',
        'shop.toast.connectWallet': 'Connect wallet first',
        'shop.toast.setReceiver': 'Set shop receiver in wallet tab',
        'shop.toast.notEnoughTon': 'Not enough coins',
        'shop.toast.purchased': '{name} purchased',
        'shop.toast.rejected': 'Transaction rejected',
        'shop.toast.failed': 'Purchase failed'
    }
};

function normalizeLocale(value) {
    return value === 'en' ? 'en' : 'ru';
}

let currentLocale = normalizeLocale(readString(STORAGE_KEYS.LANGUAGE, 'ru'));
window.getCurrentLocale = () => currentLocale;

function t(key, fallback = '', vars = {}) {
    const source = I18N[currentLocale] || I18N.ru;
    const backup = I18N.en || {};
    const raw = source[key];
    const looksBroken = typeof raw === 'string' && /\?{2,}/.test(raw);
    let text = (!looksBroken && raw) ? raw : (backup[key] || fallback || key);
    Object.entries(vars).forEach(([name, value]) => {
        text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
    });
    return text;
}

window.appTranslate = t;

function applyI18nToDom() {
    document.documentElement.lang = currentLocale;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (!key) return;
        el.textContent = t(key, el.textContent.trim());
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (!key) return;
        el.setAttribute('placeholder', t(key, el.getAttribute('placeholder') || ''));
    });
}

if (langToggle) {
    langToggle.checked = currentLocale === 'en';
}
applyI18nToDom();

let draggedRarity = null;
let touchDragState = null;
let audioCtx = null;
const rarityAccentMap = { ...DEFAULT_ACCENTS };
const slotHighlightTimers = new Map();
let dailyOrbAnimationFrame = 0;
let dailyOrbBurstTimer = 0;
let dailyOrbClaiming = false;
const DAILY_BOOST_TEST_MODE = true;
const dailyOrbMotion = {
    active: false,
    x: 0,
    y: 0,
    vx: 126,
    vy: 108,
    lastTs: 0
};

function getLocalDayKey(now = Date.now()) {
    const date = new Date(now);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function ensureDailyBoostState(now = Date.now()) {
    if (!state.dailyBoostOrb || typeof state.dailyBoostOrb !== 'object') {
        state.dailyBoostOrb = { clicks: 0, clickDayKey: '', claimedDayKey: '', activeUntil: 0 };
    }
    const dayKey = getLocalDayKey(now);
    if (state.dailyBoostOrb.clickDayKey !== dayKey) {
        state.dailyBoostOrb.clicks = 0;
        state.dailyBoostOrb.clickDayKey = dayKey;
    }
    if (Number(state.dailyBoostOrb.activeUntil || 0) <= now) {
        state.dailyBoostOrb.activeUntil = 0;
    }
}

function getDailyBoostMultiplier(now = Date.now()) {
    // Stage 3: daily rewards are no longer trusted from client-local state.
    // The server will own this multiplier in a later actions/tasks stage.
    void now;
    return 1;
}

function canShowDailyBoostOrb(now = Date.now()) {
    void now;
    return false;
}

function resetDailyBoostOrbForTesting(now = Date.now()) {
    if (!DAILY_BOOST_TEST_MODE) return;
    ensureDailyBoostState(now);
    state.dailyBoostOrb.clicks = 0;
    state.dailyBoostOrb.clickDayKey = getLocalDayKey(now);
    state.dailyBoostOrb.claimedDayKey = '';
    dailyOrbClaiming = false;
    saveState();
}

function showMinerToast(text) {
    let toast = document.getElementById('miner-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'miner-toast';
        document.body.appendChild(toast);
    }

    toast.textContent = text;
    toast.classList.remove('show');
    requestAnimationFrame(() => toast.classList.add('show'));
    clearTimeout(window.__minerToastTimeout);
    window.__minerToastTimeout = setTimeout(() => toast.classList.remove('show'), 1700);
}
window.showMinerToast = showMinerToast;

function getDisplayedBalanceValue() {
    return getProjectedBalanceNumber(state);
}

function renderServerStateNotice(error = null) {
    let notice = document.getElementById('server-state-notice');
    const needsNotice = state.serverStatus === 'error' || state.serverStatus === 'loading';
    document.body.classList.toggle('has-server-state-notice', needsNotice);
    if (!needsNotice) {
        notice?.remove();
        return;
    }

    if (!notice) {
        notice = document.createElement('div');
        notice.id = 'server-state-notice';
        notice.className = 'server-state-notice';
        notice.innerHTML = `
            <div class="server-state-copy">
                <strong></strong>
                <span></span>
            </div>
            <button type="button" class="server-state-retry"></button>
        `;
        const host = document.querySelector('.app-container') || document.body;
        host.prepend(notice);
        notice.querySelector('.server-state-retry')?.addEventListener('click', () => {
            refreshAuthoritativeState({ persist: false, silent: false }).catch(() => { });
        });
    }

    const isAuthError = error?.status === 401 || error?.code === 'missing_auth' || error?.code === 'invalid_auth';
    const title = state.serverStatus === 'loading'
        ? t('server.loadingTitle', 'Syncing server state')
        : isAuthError
            ? t('server.authTitle', 'Connect wallet to sync')
            : t('server.offlineTitle', 'Server sync unavailable');
    const body = state.serverStatus === 'loading'
        ? t('server.loadingBody', 'Loading authoritative balance and NFT state...')
        : isAuthError
            ? t('server.authBody', 'Connect TON wallet so the server can load your account.')
            : t('server.offlineBody', 'Local economy is disabled. Retry when the API is available.');

    notice.querySelector('strong').textContent = title;
    notice.querySelector('span').textContent = body;
    notice.querySelector('.server-state-retry').textContent = t('server.retry', 'Retry');
}

function applyServerStateAndRender(serverState) {
    applyAuthoritativeGameState(state, serverState);
    state.serverStatus = 'ready';
    state.serverError = null;
    renderInventory();
    renderSlots();
    renderBoostTasks();
    updateStats();
    renderServerStateNotice();
    window.dispatchEvent(new CustomEvent('game-state-updated', { detail: { state: serverState } }));
}

async function refreshAuthoritativeState({ persist = false, silent = true } = {}) {
    if (!silent) {
        state.serverStatus = 'loading';
        renderServerStateNotice();
    }

    try {
        const syncKey = `sync-${typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : Date.now()}`;
        const serverState = persist
            ? await syncGameState({ idempotencyKey: syncKey })
            : await getGameState();
        applyServerStateAndRender(serverState);
        return serverState;
    } catch (error) {
        state.serverStatus = 'error';
        state.serverError = {
            code: error?.code || 'api_error',
            message: error?.message || 'Server sync failed',
            status: error?.status || 0
        };
        renderServerStateNotice(error);
        if (!silent) {
            const mapped = mapServerActionError(error, (key, fallback) => t(key, fallback));
            showMinerToast(mapped.message || t('server.syncFailed', 'Server sync failed'));
        }
        throw error;
    }
}

function createActionIdempotencyKey(action) {
    const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${action}:${suffix}`;
}

const pendingServerActions = new Set();

function getPendingTargets(target) {
    if (!target) return [];
    if (typeof target === 'string') {
        try {
            return Array.from(document.querySelectorAll(target));
        } catch {
            return [];
        }
    }
    if (typeof Element !== 'undefined' && target instanceof Element) return [target];
    return [];
}

function setActionPendingUi(target, pending) {
    getPendingTargets(target).forEach((element) => {
        if (!element || typeof element.setAttribute !== 'function') return;
        if (pending) {
            if (!element.dataset.actionWasDisabled) {
                element.dataset.actionWasDisabled = element.disabled ? '1' : '0';
            }
            element.disabled = true;
            element.classList?.add('is-action-loading');
            element.setAttribute('aria-busy', 'true');
            return;
        }

        if (element.dataset.actionWasDisabled === '0') {
            element.disabled = false;
        }
        delete element.dataset.actionWasDisabled;
        element.classList?.remove('is-action-loading');
        element.removeAttribute('aria-busy');
    });
}

async function withServerActionPending(key, target, callback) {
    if (pendingServerActions.has(key)) return { ok: false, reason: 'action_pending' };
    pendingServerActions.add(key);
    setActionPendingUi(target, true);
    try {
        return await callback();
    } finally {
        pendingServerActions.delete(key);
        setActionPendingUi(target, false);
    }
}

function applyActionResponse(result) {
    const serverState = result?.state || result;
    if (serverState) {
        applyServerStateAndRender(serverState);
    }
    return result;
}

function showActionError(error, fallbackMessage, action = 'server_action') {
    const mapped = mapServerActionError(error, (key, fallback) => t(key, fallback));
    safeDebugLogServerActionError(error, {
        action,
        isDev: Boolean(import.meta?.env?.DEV),
        logger: console
    });

    if (mapped.normalizedCode === 'unauthorized') {
        renderServerStateNotice(error);
    }
    showMinerToast(mapped.message || fallbackMessage || t('toast.actionFailed', 'Action failed'));
    return mapped;
}

function getAudioCtx() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!audioCtx) audioCtx = new AudioCtx();
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => { });
    }
    return audioCtx;
}

function playTone(freq, start, duration, gainValue, type = 'sine') {
    const ctx = getAudioCtx();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;

    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainValue, start + Math.min(0.02, duration * 0.3));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(start);
    osc.stop(start + duration + 0.02);
}

function playCrystalInsertSound() {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;

    playTone(910, now, 0.10, 0.12, 'triangle');
    playTone(1250, now + 0.028, 0.10, 0.08, 'sine');
    playTone(1590, now + 0.054, 0.12, 0.06, 'sine');
}

function playPurchaseChime() {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;

    playTone(784, now, 0.16, 0.10, 'triangle');
    playTone(988, now + 0.04, 0.16, 0.08, 'sine');
    playTone(1174, now + 0.09, 0.21, 0.07, 'sine');
}

function playRemoveSound() {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    playTone(540, now, 0.08, 0.07, 'triangle');
    playTone(420, now + 0.05, 0.07, 0.05, 'sine');
}

function playOrbTapSound(success = false) {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (success) {
        playTone(622, now, 0.12, 0.045, 'sine');
        playTone(830, now + 0.045, 0.14, 0.04, 'triangle');
        playTone(1108, now + 0.11, 0.18, 0.032, 'sine');
        return;
    }
    playTone(540, now, 0.05, 0.022, 'sine');
    playTone(720, now + 0.022, 0.06, 0.016, 'triangle');
}

window.playPurchaseSound = playPurchaseChime;
window.playCashDing = playPurchaseChime;

const walletController = createWalletController({
    state,
    rarities: RARITIES,
    storageKeys: STORAGE_KEYS,
    appEvents: APP_EVENTS,
    tonBalanceRefreshMs: TON_BALANCE_REFRESH_MS,
    tonManifestUrl: TON_MANIFEST_URL,
    TonConnectUIClass: TonConnectUI,
    readString,
    writeString,
    emitWindowEvent,
    showToast: showMinerToast,
    getReferralLink: () => getReferralLink(),
    saveState,
    renderInventory,
    renderBoostTasks,
    updateStats,
    prepareTonProofPayload: requestTonProofPayload,
    verifyTonProofPayload: verifyTonProof,
    createPaymentOrder,
    getPaymentOrderStatus: getPaymentOrder,
    getPaymentsStatus,
    refreshServerState: refreshAuthoritativeState,
    createActionIdempotencyKey,
    onAuthReady: () => {
        refreshAuthoritativeState({ persist: false, silent: false }).catch(() => { });
    },
    onAuthError: () => {
        state.serverStatus = 'error';
        state.serverError = { code: 'invalid_auth', message: 'TON proof verification failed', status: 401 };
        renderServerStateNotice({ code: 'invalid_auth', status: 401 });
    },
    dom: {
        navWalletBtn,
        navWalletLabel,
        walletStatusText,
        walletAddressValue,
        walletTonBalanceValue,
        walletConnectActionBtn,
        walletDisconnectBtn,
        walletCopyAddressBtn,
        walletReferralInput,
        walletRefreshNftsBtn,
        walletNftCount,
        walletNftSummary,
        walletNftState,
        walletNftGrid,
        walletPaymentModeValue,
        walletPaymentStatusValue,
        shopReceiverInput
    }
});

window.getTonWalletAddress = walletController.getTonWalletAddress;
window.getTonBalanceTon = walletController.getTonBalanceTon;
window.getWalletNfts = walletController.getWalletNfts;
window.getShopTonReceiverAddress = walletController.getShopTonReceiverAddress;
window.purchaseShopItemWithTon = purchaseShopItemWithTon;

async function runCoinBoostAction() {
    return withServerActionPending('boost-coin', '.boost-coin-buy-btn', async () => {
        try {
            const result = await activateCoinBoost({
                idempotencyKey: createActionIdempotencyKey('boost-coin')
            });
            applyActionResponse(result);
            playPurchaseChime();
            const panel = document.querySelector('#boostCoinList .boost-coin-panel') || boostCoinList;
            triggerBoostFeedback(panel, 'var(--accent-gold)');
            showMinerToast(t('toast.coinBoostBought', 'Boost purchased'));
            return { ok: true, result };
        } catch (error) {
            showActionError(error, t('boost.coinFailed', 'Failed to buy boost'), 'boost_coin_activate');
            refreshAuthoritativeState({ persist: false, silent: true }).catch(() => { });
            return { ok: false, reason: error?.code || 'api_error', error };
        }
    });
}

async function runNftBoostAction(quest) {
    if (!quest?.rarityId) return;
    const selector = `#boostQuestList .boost-activate-btn[data-quest-id="${quest.id}"]`;
    return withServerActionPending(`boost-nft-${quest.rarityId}`, selector, async () => {
        try {
            const result = await activateNftBoost({
                rarityId: quest.rarityId,
                idempotencyKey: createActionIdempotencyKey(`boost-nft-${quest.rarityId}`)
            });
            applyActionResponse(result);
            playPurchaseChime();
            const btn = document.querySelector(selector);
            triggerBoostFeedback(btn, `var(--rarity-${quest.rarityId})`);
            openBoostActivatedPrompt(quest).catch(() => { });
            return { ok: true, result };
        } catch (error) {
            const mapped = mapServerActionError(error, (key, fallback) => t(key, fallback));
            if (mapped.normalizedCode === 'nft_required') {
                openBuyNftPrompt(quest, {
                    owned: error.details?.owned,
                    requiredTotal: error.details?.required,
                    needed: error.details?.needed
                }).catch(() => { });
                safeDebugLogServerActionError(error, {
                    action: 'boost_nft_activate',
                    isDev: Boolean(import.meta?.env?.DEV),
                    logger: console
                });
                return { ok: false, reason: mapped.normalizedCode, error };
            }
            showActionError(error, t('boost.nftFailed', 'Failed to activate NFT boost'), 'boost_nft_activate');
            refreshAuthoritativeState({ persist: false, silent: true }).catch(() => { });
            return { ok: false, reason: error?.code || 'api_error', error };
        }
    });
}

async function runTonBoostPayment(plan) {
    if (!plan?.id) return;
    return withServerActionPending(`payment-ton-boost-${plan.id}`, `.boost-ton-buy-btn[data-ton-boost-id="${plan.id}"]`, async () => {
        try {
            const result = await walletController.purchaseTimedTonBoost(plan);
            if (result?.ok) {
                playPurchaseChime();
                boostController.renderBoostTasks();
                updateStats();
                return result;
            }
            if (result?.reason && !['wallet_not_connected', 'expired', 'pending_timeout'].includes(result.reason)) {
                showMinerToast(t('payments.failed', 'Payment failed'));
            }
            return result || { ok: false, reason: 'payment_failed' };
        } catch (error) {
            showActionError(error, t('payments.failed', 'Payment failed'), 'payments_orders');
            return { ok: false, reason: error?.code || 'api_error', error };
        }
    });
}

const boostController = createBoostController({
    state,
    rarities: RARITIES,
    boostQuests: BOOST_QUESTS,
    coinBoostLevels: COIN_BOOST_LEVELS,
    tonBoostPlans: TON_BOOST_PLANS,
    boostQuestListEl: boostQuestList,
    boostCoinListEl: boostCoinList,
    boostTonListEl: boostTonList,
    boostTotalPerSecEl: boostTotalPerSecEl,
    boostCoinPerSecEl: boostCoinPerSecEl,
    saveState,
    updateStats,
    showToast: showMinerToast,
    economyActionsEnabled: ECONOMY_ACTIONS_ENABLED,
    onServerActionPending: (action, details = {}) => {
        if (action === 'coin_boost') {
            runCoinBoostAction();
            return;
        }
        if (action === 'nft_boost') {
            runNftBoostAction(details.quest);
            return;
        }
        if (action === 'ton_boost') {
            runTonBoostPayment(details.plan);
            return;
        }
        showMinerToast(t('toast.serverActionPending', 'This action will sync through the server'));
        refreshAuthoritativeState({ persist: false, silent: true }).catch(() => { });
    },
    onNeedNft: (quest, info) => {
        openBuyNftPrompt(quest, info).catch(() => { });
    },
    onBoostActivated: (quest) => {
        playPurchaseChime();
        const btn = document.querySelector(`#boostQuestList .boost-activate-btn[data-quest-id="${quest.id}"]`);
        triggerBoostFeedback(btn, `var(--rarity-${quest.rarityId})`);
        openBoostActivatedPrompt(quest).catch(() => { });
    },
    onCoinBoostPurchased: () => {
        playPurchaseChime();
        const panel = document.querySelector('#boostCoinList .boost-coin-panel') || boostCoinList;
        triggerBoostFeedback(panel, 'var(--accent-gold)');
    },
    t: (key, fallback, vars) => t(key, fallback, vars)
});

const tasksController = createTasksController({
    elements: {
        status: tasksStatus,
        list: tasksList,
        telegramPanel: tasksTelegramPanel,
        telegramLinkBtn: tasksTelegramLinkBtn,
        telegramStatus: tasksTelegramStatus,
        referralCodeInput,
        referralCopyBtn,
        referralApplyInput,
        referralApplyBtn,
        referralSummary
    },
    api: {
        getTasks,
        claimTask,
        getReferralsMe,
        applyReferralCode,
        verifyTelegramWebApp,
        verifyTelegram: verifyTelegramWebApp,
        getCurrentUser
    },
    applyServerState: applyServerStateAndRender,
    refreshState: refreshAuthoritativeState,
    showToast: showMinerToast,
    t: (key, fallback, vars) => t(key, fallback, vars),
    createIdempotencyKey: createActionIdempotencyKey,
    getWindow: () => window,
    getTelegramOpenUrl: getPublicTelegramOpenUrl,
    onConnectWallet: () => {
        setActiveScreen(APP_SCREENS.WALLET);
        walletController.openTonConnectFlow();
    }
});

const adminController = createAdminController({
    elements: {
        status: adminStatus,
        searchInput: adminSearchInput,
        refreshBtn: adminRefreshBtn,
        users: adminUsersTable,
        userDetail: adminUserDetailTable,
        ledger: adminLedgerTable,
        payments: adminPaymentsTable,
        tasks: adminTasksTable,
        referrals: adminReferralsTable,
        withdrawals: adminWithdrawalsTable,
        auditLogs: adminAuditLogsTable
    },
    api: {
        getAdminUsers,
        getAdminUser,
        getAdminUserLedger,
        getAdminUserTasks,
        getAdminUserReferrals,
        getAdminPaymentOrders,
        getAdminPayment,
        getAdminWithdrawals,
        getAdminWithdrawal,
        markAdminWithdrawalUnderReview,
        rejectAdminWithdrawal,
        markAdminWithdrawalPaidExternal,
        getAdminAuditLogs
    },
    createIdempotencyKey: createActionIdempotencyKey
});
adminController.init();

const screenController = createScreenController({
    appScreens: APP_SCREENS,
    state,
    dom: {
        minerScreen,
        tasksScreen,
        boostScreen,
        shopScreen,
        walletScreen,
        adminScreen,
        navMinerBtn,
        navTasksBtn,
        navBoostBtn,
        navShopBtn,
        navWalletBtn,
        aiChatWidget
    },
    saveState,
    onEnterTasks: () => tasksController.load({ silent: true }).catch(() => { }),
    onEnterBoost: () => boostController.renderBoostTasks(),
    onEnterShop: () => {
        // shop.js reacts to screen-change event below
    },
    onEnterWallet: () => {
        walletController.updateWalletUI();
        walletController.refreshPaymentsStatus?.().catch(() => { });
        walletController.fetchTonBalance().catch(() => { });
        walletController.fetchWalletNfts().catch(() => { });
    },
    onEnterAdmin: () => {
        adminController.load().catch(() => { });
    }
});

function getTonBalanceTon() {
    return walletController.getTonBalanceTon();
}

function updateWalletUI() {
    walletController.updateWalletUI();
}

function setShopTonReceiverAddress(address) {
    walletController.setShopTonReceiverAddress(address);
}

async function fetchTonBalance() {
    return walletController.fetchTonBalance();
}

async function fetchWalletNfts() {
    return walletController.fetchWalletNfts();
}

async function purchaseShopItemWithTon(rarity) {
    if (!rarity?.id) return { ok: false, reason: 'invalid_rarity' };
    return withServerActionPending(`payment-shop-${rarity.id}`, '#shopBuyBtn, #shopConfirmYes', async () => {
        try {
            const result = await walletController.purchaseShopItemWithTon(rarity);
            if (result?.ok) {
                playPurchaseChime();
                return result;
            }
            return result || { ok: false, reason: 'payment_failed' };
        } catch (error) {
            const mapped = showActionError(error, t('payments.failed', 'Payment failed'), 'payments_orders');
            return { ok: false, reason: mapped?.normalizedCode || error?.code || 'api_error', message: mapped?.message, error };
        }
    });
}

async function purchaseShopItemWithBalance(rarity) {
    if (!rarity?.id) return { ok: false, reason: 'invalid_rarity' };
    return withServerActionPending(`shop-buy-${rarity.id}`, '#shopBuyBtn, #shopConfirmYes', async () => {
        try {
            const result = await buyShopItem({
                rarityId: rarity.id,
                idempotencyKey: createActionIdempotencyKey(`shop-buy-${rarity.id}`)
            });
            applyActionResponse(result);
            playPurchaseChime();
            return { ok: true, result };
        } catch (error) {
            const mapped = showActionError(error, t('shop.toast.failed', 'Purchase failed'), 'shop_buy');
            return { ok: false, reason: mapped?.normalizedCode || error?.code || 'api_error', message: mapped?.message, error };
        }
    });
}

window.purchaseShopItemWithBalance = purchaseShopItemWithBalance;

async function openTonConnectFlow() {
    return walletController.openTonConnectFlow();
}

async function disconnectTonWallet() {
    try {
        await logoutAuthSession();
    } catch {
        clearApiAuthSession();
    }
    return walletController.disconnectTonWallet();
}

async function initTonConnect() {
    return walletController.initTonConnect();
}

registerBridge({
    wallet: {
        getAddress: walletController.getTonWalletAddress,
        getBalanceTon: walletController.getTonBalanceTon,
        getNfts: walletController.getWalletNfts,
        getShopReceiverAddress: walletController.getShopTonReceiverAddress
    },
    ui: {
        showToast: showMinerToast
    },
    audio: {
        playPurchaseSound: playPurchaseChime
    },
    game: {
        getBalance: getDisplayedBalanceValue,
        refreshState: () => refreshAuthoritativeState({ persist: false, silent: true })
    },
    shop: {
        purchaseWithTon: purchaseShopItemWithTon,
        purchaseWithBalance: purchaseShopItemWithBalance
    }
});
function getActivatedBoostPerSec() {
    return boostController.getActivatedBoostPerSec();
}

function getCoinBoostPerSec() {
    return boostController.getCoinBoostPerSec();
}

function isBoostQuestReady(quest) {
    return !!quest && (state.collectedTotals[quest.rarityId] || 0) >= quest.target;
}

function setActiveScreen(screen) {
    screenController.setActiveScreen(screen);
    if (screen === APP_SCREENS.BOOST) {
        resetDailyBoostOrbForTesting();
    }
    emitWindowEvent(APP_EVENTS.SCREEN_CHANGED, { screen });
    renderDailyBoostOrb();
}
window.setActiveScreen = setActiveScreen;

function isAdminRoute() {
    const params = new URLSearchParams(window.location.search || '');
    return window.location.hash === '#admin' || params.get('admin') === '1';
}

window.addEventListener('hashchange', () => {
    if (isAdminRoute()) {
        setActiveScreen(APP_SCREENS.ADMIN);
    }
});

function activateBoostQuest(questId) {
    boostController.activateBoostQuest(questId);
}

function renderBoostTasks() {
    boostController.renderBoostTasks();
}

function getReferralCode() {
    return getOrCreateReferralCode({
        walletAddress: walletController.getTonWalletAddress(),
        storageKey: STORAGE_KEYS.REFERRAL_CODE
    });
}

function getReferralLink() {
    return buildReferralLink(window.location.href, getReferralCode());
}

async function copyReferralLink() {
    const link = getReferralLink();
    try {
        await navigator.clipboard.writeText(link);
        showMinerToast(t('toast.refLinkCopied', 'Referral link copied'));
    } catch (err) {
        if (walletReferralInput) {
            walletReferralInput.focus();
            walletReferralInput.select();
            document.execCommand('copy');
            showMinerToast(t('toast.refLinkCopied', 'Referral link copied'));
        } else {
            console.error(err);
        }
    }
}

async function copyWalletAddress() {
    const address = walletController.getTonWalletAddress();
    if (!address) return;
    try {
        await navigator.clipboard.writeText(address);
        showMinerToast(t('wallet.toast.addressCopied', 'Wallet address copied'));
    } catch (err) {
        if (walletAddressValue) {
            const range = document.createRange();
            range.selectNodeContents(walletAddressValue);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
            document.execCommand('copy');
            selection?.removeAllRanges();
            showMinerToast(t('wallet.toast.addressCopied', 'Wallet address copied'));
        } else {
            console.error(err);
        }
    }
}

function getSlotAccent(rarityId) {
    return rarityAccentMap[rarityId] || DEFAULT_ACCENTS[rarityId] || [165, 130, 76];
}

function formatBoostPerSec(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return '0';
    const abs = Math.abs(num);
    const fixed = abs >= 100 ? num.toFixed(1) : abs >= 1 ? num.toFixed(2) : abs >= 0.01 ? num.toFixed(3) : num.toFixed(4);
    return fixed.replace(/\.0+$|(\.\d*?[1-9])0+$/, '$1');
}

function formatTonCost(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return '0';
    if (Number.isInteger(num)) return String(num);
    return num.toFixed(3).replace(/\.0+$|(\.\d*?[1-9])0+$/, '$1');
}

function getBoostStackMarkup(rarity, activeCount = 0) {
    if (!rarity) {
        return `<span class="boost-value">+0</span><span class="boost-unit">hour</span>`;
    }
    if (rarity.id === 'gold') {
        const multiplier = Math.max(1, Number(rarity.incomeMultiplier || 1) * Math.max(0, Number(activeCount || 0)));
        return `<span class="boost-value">x${formatBoostPerSec(multiplier)}</span><span class="boost-unit">${t('boost.incomeUnit', 'income')}</span>`;
    }
    const valuePerHour = Number(rarity.boost || 0) * Number(activeCount || 0) * 3600;
    return `<span class="boost-value">+${formatBoostPerSec(valuePerHour)}</span><span class="boost-unit">hour</span>`;
}

function openShopForRarity(rarityId) {
    setActiveScreen(APP_SCREENS.SHOP);
    window.dispatchEvent(new CustomEvent('shop-open-rarity', { detail: { rarityId } }));
}

let routeConfirmResolve = null;

function closeRouteConfirm(result) {
    if (!routeConfirmModal) return;
    routeConfirmModal.classList.remove('active');
    routeConfirmModal.style.display = 'none';
    const resolve = routeConfirmResolve;
    routeConfirmResolve = null;
    if (typeof resolve === 'function') {
        resolve(result);
    }
}

function openRouteConfirm(message, title = t('app.confirmTitle', 'Confirm action'), options = {}) {
    if (!routeConfirmModal || !routeConfirmTitle || !routeConfirmText) {
        return Promise.resolve(window.confirm(message));
    }
    if (options?.accentColor) {
        routeConfirmModal.style.setProperty('--confirm-accent', options.accentColor);
    } else {
        routeConfirmModal.style.removeProperty('--confirm-accent');
    }
    if (routeConfirmYes) {
        routeConfirmYes.textContent = options?.yesLabel || t('shop.confirmYes', 'YES');
    }
    if (routeConfirmNo) {
        routeConfirmNo.textContent = options?.noLabel || t('shop.confirmNo', 'NO');
        routeConfirmNo.style.display = options?.hideNo ? 'none' : '';
    }
    routeConfirmTitle.textContent = title;
    routeConfirmText.textContent = message;
    routeConfirmModal.style.display = 'flex';
    requestAnimationFrame(() => routeConfirmModal.classList.add('active'));
    return new Promise((resolve) => {
        routeConfirmResolve = resolve;
    });
}

async function openBuyNftPrompt(quest, info = null) {
    const rarity = RARITIES.find((r) => r.id === quest?.rarityId);
    if (!rarity) return;
    const progress = Math.max(0, Number(info?.owned || 0));
    const target = Math.max(1, Number(info?.requiredTotal || info?.target || quest?.target || 1));
    const needed = Math.max(0, Number(info?.needed || 0));
    const hasAnyNft = progress > 0;
    const bodyText = hasAnyNft
        ? t(
            'boost.popupNeedMoreBody',
            'To upgrade, you need {required}/10 NFT. Current: {progress}/10. Need {needed} more. Go to shop?',
            { progress, required: target, needed }
        )
        : t(
            'boost.popupNoNftBody',
            'You do not have enough NFT for this boost yet. Buy NFT in shop or connect a wallet with NFT. Go to shop?'
        );
    const confirmed = await openRouteConfirm(
        bodyText,
        t('boost.popupNoNftTitle', 'No NFT'),
        {
            accentColor: `var(--rarity-${rarity.id})`,
            yesLabel: t('boost.popupGoShop', 'Go shop'),
            noLabel: t('boost.popupCancel', 'Cancel')
        }
    );
    if (!confirmed) return;
    openShopForRarity(rarity.id);
}

async function openBoostActivatedPrompt(quest) {
    const rarity = RARITIES.find((r) => r.id === quest?.rarityId);
    const boostPerHour = Number(quest?.rewardPerSec || 0) * 3600;
    await openRouteConfirm(
        t('boost.popupActivatedBody', '+{boost} / hour', { boost: formatBoostPerSec(boostPerHour) }),
        t('boost.popupActivatedTitle', 'Boost activated'),
        {
            accentColor: rarity ? `var(--rarity-${rarity.id})` : 'var(--accent-gold)',
            yesLabel: t('boost.popupOk', 'OK'),
            hideNo: true
        }
    );
}

function triggerBoostFeedback(targetEl, accentColor = 'var(--accent-gold)') {
    if (!targetEl) return;
    targetEl.style.setProperty('--boost-flash-color', accentColor);
    targetEl.classList.remove('boost-feedback-flash');
    void targetEl.offsetWidth;
    targetEl.classList.add('boost-feedback-flash');
    setTimeout(() => targetEl.classList.remove('boost-feedback-flash'), 520);
}

function renderDailyBoostOrb() {
    if (!dailyBoostOrbLayer || !dailyBoostOrb || !dailyBoostOrbCount) return;
    const visible = canShowDailyBoostOrb() || dailyOrbClaiming;
    dailyBoostOrbLayer.classList.toggle('hidden', !visible);
    dailyBoostOrbLayer.classList.toggle('is-active', visible);
    if (!visible) {
        dailyBoostOrb.classList.remove('is-claiming');
        resetDailyBoostOrbPointer();
        stopDailyBoostOrbMotion();
        return;
    }
    ensureDailyBoostState();
    const clicks = Math.min(5, state.dailyBoostOrb.clicks || 0);
    dailyBoostOrbCount.textContent = `${clicks}/5`;
    if (dailyBoostOrbProgress) {
        dailyBoostOrbProgress.style.width = `${(clicks / 5) * 100}%`;
    }
    if (!dailyOrbMotion.active && !dailyOrbClaiming) {
        startDailyBoostOrbMotion();
    }
}

function getDailyOrbBounds() {
    const host = boostScreen;
    if (!host || !dailyBoostOrb) return null;
    const orbWidth = dailyBoostOrb.offsetWidth || 92;
    const orbHeight = dailyBoostOrb.offsetHeight || 104;
    const width = Math.max(0, host.clientWidth - orbWidth);
    const top = Math.min(Math.max(250, host.clientHeight * 0.34), Math.max(250, host.clientHeight - 220));
    const bottom = Math.max(top + 16, host.clientHeight - 140);
    const height = Math.max(0, bottom - top - orbHeight);
    return { width, height, offsetTop: top };
}

function positionDailyBoostOrb() {
    if (!dailyBoostOrb) return;
    dailyBoostOrb.style.left = `${dailyOrbMotion.x}px`;
    dailyBoostOrb.style.top = `${dailyOrbMotion.y}px`;
}

function updateDailyBoostOrbPointer(clientX, clientY) {
    if (!dailyBoostOrb || !dailyBoostOrbLayer || dailyBoostOrbLayer.classList.contains('hidden')) return;
    const rect = dailyBoostOrb.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = Math.max(-1, Math.min(1, (clientX - cx) / (rect.width * 1.1)));
    const dy = Math.max(-1, Math.min(1, (clientY - cy) / (rect.height * 1.1)));
    dailyBoostOrb.style.setProperty('--ghost-look-x', `${dx * 8}px`);
    dailyBoostOrb.style.setProperty('--ghost-look-y', `${dy * 6}px`);
    dailyBoostOrb.style.setProperty('--ghost-glow-x', `${dx * 28}px`);
    dailyBoostOrb.style.setProperty('--ghost-glow-y', `${dy * 20}px`);
    dailyBoostOrb.style.setProperty('--ghost-tilt', `${dx * 9}deg`);
}

function resetDailyBoostOrbPointer() {
    if (!dailyBoostOrb) return;
    dailyBoostOrb.style.setProperty('--ghost-look-x', '0px');
    dailyBoostOrb.style.setProperty('--ghost-look-y', '0px');
    dailyBoostOrb.style.setProperty('--ghost-glow-x', '0px');
    dailyBoostOrb.style.setProperty('--ghost-glow-y', '0px');
    dailyBoostOrb.style.setProperty('--ghost-tilt', '0deg');
}

function animateDailyBoostOrb(ts) {
    if (!dailyOrbMotion.active || !dailyBoostOrb || !dailyBoostOrbLayer || dailyBoostOrbLayer.classList.contains('hidden')) {
        dailyOrbAnimationFrame = 0;
        return;
    }
    if (!dailyOrbMotion.lastTs) dailyOrbMotion.lastTs = ts;
    const dt = Math.min(0.028, (ts - dailyOrbMotion.lastTs) / 1000 || 0.016);
    dailyOrbMotion.lastTs = ts;

    const bounds = getDailyOrbBounds();
    if (!bounds) {
        dailyOrbAnimationFrame = requestAnimationFrame(animateDailyBoostOrb);
        return;
    }

    dailyOrbMotion.x += dailyOrbMotion.vx * dt;
    dailyOrbMotion.y += dailyOrbMotion.vy * dt;

    if (dailyOrbMotion.x <= 0) {
        dailyOrbMotion.x = 0;
        dailyOrbMotion.vx = Math.abs(dailyOrbMotion.vx);
    } else if (dailyOrbMotion.x >= bounds.width) {
        dailyOrbMotion.x = bounds.width;
        dailyOrbMotion.vx = -Math.abs(dailyOrbMotion.vx);
    }

    if (dailyOrbMotion.y <= bounds.offsetTop) {
        dailyOrbMotion.y = bounds.offsetTop;
        dailyOrbMotion.vy = Math.abs(dailyOrbMotion.vy);
    } else if (dailyOrbMotion.y >= bounds.offsetTop + bounds.height) {
        dailyOrbMotion.y = bounds.offsetTop + bounds.height;
        dailyOrbMotion.vy = -Math.abs(dailyOrbMotion.vy);
    }

    positionDailyBoostOrb();
    dailyOrbAnimationFrame = requestAnimationFrame(animateDailyBoostOrb);
}

function startDailyBoostOrbMotion() {
    if (!dailyBoostOrb || !dailyBoostOrbLayer) return;
    const bounds = getDailyOrbBounds();
    if (!bounds) return;
    dailyOrbMotion.active = true;
    dailyOrbMotion.lastTs = 0;
    if (!Number.isFinite(dailyOrbMotion.x) || dailyOrbMotion.x === 0) {
        dailyOrbMotion.x = Math.max(16, bounds.width * 0.64);
        dailyOrbMotion.y = bounds.offsetTop + Math.max(10, bounds.height * 0.3);
        dailyOrbMotion.vx = 126;
        dailyOrbMotion.vy = 108;
    }
    positionDailyBoostOrb();
    if (!dailyOrbAnimationFrame) {
        dailyOrbAnimationFrame = requestAnimationFrame(animateDailyBoostOrb);
    }
}

function stopDailyBoostOrbMotion() {
    dailyOrbMotion.active = false;
    dailyOrbMotion.lastTs = 0;
    if (dailyOrbAnimationFrame) {
        cancelAnimationFrame(dailyOrbAnimationFrame);
        dailyOrbAnimationFrame = 0;
    }
}

function emitDailyBoostOrbBurst(success = false) {
    if (!dailyBoostOrbLayer || !dailyBoostOrb) return;
    const rect = dailyBoostOrb.getBoundingClientRect();
    const hostRect = dailyBoostOrbLayer.getBoundingClientRect();
    const cx = rect.left - hostRect.left + rect.width / 2;
    const cy = rect.top - hostRect.top + rect.height / 2;
    const total = success ? 16 : 10;
    for (let i = 0; i < total; i += 1) {
        const particle = document.createElement('span');
        particle.className = `daily-boost-orb-particle ${i % 3 === 0 ? 'is-droplet' : 'is-spark'}`;
        particle.style.left = `${cx}px`;
        particle.style.top = `${cy}px`;
        const angle = (Math.PI * 2 * i) / total + Math.random() * 0.42;
        const distance = (success ? 34 : 24) + Math.random() * (success ? 34 : 18);
        const scale = (success ? 0.8 : 0.55) + Math.random() * 0.75;
        const duration = (success ? 760 : 520) + Math.random() * 180;
        particle.style.setProperty('--orb-particle-scale', scale.toFixed(3));
        particle.animate([
            { transform: 'translate3d(0, 0, 0) scale(var(--orb-particle-scale, 1))', opacity: success ? 1 : 0.9 },
            { transform: `translate3d(${Math.cos(angle) * distance}px, ${Math.sin(angle) * distance - (success ? 14 : 6)}px, 0) scale(0.2)`, opacity: 0 }
        ], { duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
        dailyBoostOrbLayer.appendChild(particle);
        setTimeout(() => particle.remove(), duration + 30);
    }
}

function emitDailyBoostOrbRewardLabel() {
    if (!dailyBoostOrbLayer || !dailyBoostOrb) return;
    const label = document.createElement('div');
    label.className = 'daily-boost-orb-reward';
    label.textContent = t('boost.dailyRewardLabel', 'x2 • 1 hour');
    const rect = dailyBoostOrb.getBoundingClientRect();
    const hostRect = dailyBoostOrbLayer.getBoundingClientRect();
    label.style.left = `${rect.left - hostRect.left + rect.width / 2}px`;
    label.style.top = `${rect.top - hostRect.top + rect.height * 0.58}px`;
    dailyBoostOrbLayer.appendChild(label);
    label.animate([
        { transform: 'translate3d(-50%, 0, 0) scale(0.92)', opacity: 0 },
        { transform: 'translate3d(-50%, -10px, 0) scale(1)', opacity: 1, offset: 0.28 },
        { transform: 'translate3d(-50%, -34px, 0) scale(1.02)', opacity: 1, offset: 0.72 },
        { transform: 'translate3d(-50%, -48px, 0) scale(0.96)', opacity: 0 }
    ], { duration: 1200, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    setTimeout(() => label.remove(), 1230);
}

function playDailyBoostOrbClaimAnimation() {
    if (!dailyBoostOrb) return;
    dailyOrbClaiming = true;
    stopDailyBoostOrbMotion();
    dailyBoostOrb.classList.remove('is-pop');
    dailyBoostOrb.classList.add('is-claiming');
    emitDailyBoostOrbBurst(true);
    setTimeout(() => emitDailyBoostOrbBurst(true), 120);
    emitDailyBoostOrbRewardLabel();
    clearTimeout(dailyOrbBurstTimer);
    dailyOrbBurstTimer = setTimeout(() => {
        dailyBoostOrb.classList.remove('is-claiming');
        dailyOrbClaiming = false;
        renderDailyBoostOrb();
    }, 1220);
}

function handleDailyBoostOrbClick() {
    ensureDailyBoostState();
    if (dailyOrbClaiming) return;
    if (!canShowDailyBoostOrb()) {
        showMinerToast(t('toast.dailyBoostCooldown', 'Orb returns tomorrow'));
        return;
    }

    state.dailyBoostOrb.clicks = Math.min(5, Number(state.dailyBoostOrb.clicks || 0) + 1);
    state.dailyBoostOrb.clickDayKey = getLocalDayKey();
    dailyOrbMotion.vx += (Math.random() > 0.5 ? 1 : -1) * (60 + Math.random() * 40);
    dailyOrbMotion.vy += (Math.random() > 0.5 ? 1 : -1) * (50 + Math.random() * 36);
    dailyBoostOrb.classList.remove('is-pop');
    void dailyBoostOrb.offsetWidth;
    dailyBoostOrb.classList.add('is-pop');
    clearTimeout(dailyOrbBurstTimer);
    dailyOrbBurstTimer = setTimeout(() => dailyBoostOrb.classList.remove('is-pop'), 180);
    emitDailyBoostOrbBurst(false);

    if (state.dailyBoostOrb.clicks >= 5) {
        state.dailyBoostOrb.claimedDayKey = getLocalDayKey();
        state.dailyBoostOrb.activeUntil = Date.now() + 60 * 60 * 1000;
        playOrbTapSound(true);
        saveState();
        updateStats();
        playDailyBoostOrbClaimAnimation();
        showMinerToast(t('toast.dailyBoostActivated', 'Daily boost activated: x2 for 1 hour'));
        return;
    }

    playOrbTapSound(false);
    saveState();
    renderDailyBoostOrb();
    showMinerToast(t('toast.dailyBoostProgress', 'Orb: {count}/5', { count: state.dailyBoostOrb.clicks }));
}

function applySlotAccent(slotEl, rarityId) {
    const [r, g, b] = getSlotAccent(rarityId);
    slotEl.style.setProperty('--slot-accent', `rgb(${r}, ${g}, ${b})`);
    slotEl.style.setProperty('--slot-accent-rgb', `${r}, ${g}, ${b}`);
}

function samplePosterAccent(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (!ctx) {
                    reject(new Error('Canvas context unavailable'));
                    return;
                }

                const size = 28;
                canvas.width = size;
                canvas.height = size;
                ctx.drawImage(img, 0, 0, size, size);
                const data = ctx.getImageData(0, 0, size, size).data;

                let rr = 0;
                let gg = 0;
                let bb = 0;
                let weightSum = 0;

                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i];
                    const g = data[i + 1];
                    const b = data[i + 2];
                    const a = data[i + 3];
                    if (a < 120) continue;

                    const max = Math.max(r, g, b);
                    const min = Math.min(r, g, b);
                    const sat = max === 0 ? 0 : (max - min) / max;
                    const lum = (r + g + b) / 3;
                    if (lum < 28) continue;

                    const w = 0.35 + sat * 1.8;
                    rr += r * w;
                    gg += g * w;
                    bb += b * w;
                    weightSum += w;
                }

                if (weightSum < 1) {
                    reject(new Error('No bright pixels'));
                    return;
                }

                resolve([
                    Math.round(rr / weightSum),
                    Math.round(gg / weightSum),
                    Math.round(bb / weightSum)
                ]);
            } catch (err) {
                reject(err);
            }
        };

        img.onerror = () => reject(new Error(`Failed to load image ${src}`));
        img.src = src;
    });
}

async function initRarityAccents() {
    if (shouldSkipAccentSampling()) {
        RARITIES.forEach((rarity) => {
            rarityAccentMap[rarity.id] = DEFAULT_ACCENTS[rarity.id];
        });
        renderSlots();
        return;
    }

    await Promise.all(RARITIES.map(async (rarity) => {
        try {
            const rgb = await samplePosterAccent(rarity.poster);
            rarityAccentMap[rarity.id] = rgb;
        } catch (err) {
            rarityAccentMap[rarity.id] = DEFAULT_ACCENTS[rarity.id];
        }
    }));

    renderSlots();
}

function hidePreloadScreen() {
    if (preloadScreenEl) {
        preloadScreenEl.classList.add('hidden');
        setTimeout(() => preloadScreenEl.remove(), 450);
    }
    document.body.classList.remove('app-preloading');
}

function updatePreloadProgress(loaded, total, label = '???????? ??????????...') {
    if (preloadSubEl) {
        preloadSubEl.textContent = `${label} (${loaded}/${total})`;
    }
    if (preloadBarFillEl) {
        const ratio = total > 0 ? Math.max(0.08, Math.min(1, loaded / total)) : 1;
        preloadBarFillEl.style.animation = 'none';
        preloadBarFillEl.style.width = `${Math.round(ratio * 100)}%`;
        preloadBarFillEl.style.transform = 'none';
    }
}

function preloadImage(src) {
    return new Promise((resolve) => {
        const img = new Image();
        let settled = false;
        const done = () => {
            if (settled) return;
            settled = true;
            resolve();
        };
        img.decoding = 'async';
        img.onload = async () => {
            try {
                if (typeof img.decode === 'function') {
                    await img.decode();
                }
            } catch (_) { }
            done();
        };
        img.onerror = done;
        setTimeout(done, 1800);
        img.src = src;
    });
}

function preloadVideo(url) {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.setAttribute('muted', '');

        let settled = false;
        const done = () => {
            if (settled) return;
            settled = true;
            resolve();
        };

        video.addEventListener('loadedmetadata', done, { once: true });
        video.addEventListener('loadeddata', done, { once: true });
        video.addEventListener('canplay', done, { once: true });
        video.addEventListener('canplaythrough', done, { once: true });
        video.addEventListener('error', done, { once: true });
        setTimeout(done, 3200);

        video.src = url;
        video.load();
    });
}

async function preloadBootAssets() {
    const imageJobs = RARITIES.map((r) => () => preloadImage(r.poster));
    const warmVideoUrls = Array.from(new Set(RARITIES.flatMap((r) => [r.video, r.slotVideo || r.video])));
    const videoJobs = warmVideoUrls.map((url) => () => preloadVideo(url));

    updatePreloadProgress(0, imageJobs.length, t('preload.cards', 'Loading NFT cards...'));
    let loaded = 0;
    await Promise.race([
        Promise.allSettled(imageJobs.map(async (job) => {
            await job();
            loaded += 1;
            updatePreloadProgress(loaded, imageJobs.length, t('preload.cards', 'Loading NFT cards...'));
        })),
        new Promise((resolve) => setTimeout(resolve, 1200))
    ]);

    updatePreloadProgress(imageJobs.length, imageJobs.length, t('preload.almostReady', 'Almost ready...'));
    // Warm videos in background so app starts quickly while shop media becomes instant.
    Promise.allSettled(videoJobs.map((job) => job())).catch(() => { });
}

function shouldSkipAccentSampling() {
    // Keep slot glow stable: avoid delayed accent re-sampling + re-render after boot.
    return true;
}

function initTelegramWebApp() {
    const tg = window.Telegram?.WebApp;
    if (!tg) return;

    try { tg.ready(); } catch (_) { }
    try { tg.expand(); } catch (_) { }
    try { tg.disableVerticalSwipes?.(); } catch (_) { }
    try { tg.disableClosingConfirmation?.(); } catch (_) { }
}

function init() {
    renderInventory();
    renderSlots();
    renderBoostTasks();
    updateStats();
    updateWalletUI();
    renderDailyBoostOrb();
    setActiveScreen(isAdminRoute() ? APP_SCREENS.ADMIN : (state.ui.screen || APP_SCREENS.MINER));

    if (navMinerBtn) {
        navMinerBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            setActiveScreen(APP_SCREENS.MINER);
        });
    }
    if (minerHelpBtn) {
        minerHelpBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showMinerToast(t('miner.dragHelp', 'Drag card from top lane to same-rarity slot below to activate boost.'));
        });
    }
    if (navWalletBtn) {
        navWalletBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            setActiveScreen(APP_SCREENS.WALLET);
        });
    }
    if (boostScreen) {
        boostScreen.addEventListener('click', (e) => {
            const questBtn = e.target.closest('.boost-activate-btn');
            if (questBtn && !questBtn.disabled) {
                const questId = questBtn.dataset.questId;
                if (questId) activateBoostQuest(questId);
                return;
            }
            const coinBtn = e.target.closest('.boost-coin-buy-btn');
            if (coinBtn && !coinBtn.disabled) {
                boostController.purchaseCoinBoost();
                return;
            }
            const tonBtn = e.target.closest('.boost-ton-buy-btn');
            if (tonBtn && !tonBtn.disabled) {
                boostController.purchaseTonBoost(tonBtn.dataset.tonBoostId);
            }
        });
    }
    if (dailyBoostOrb) {
        dailyBoostOrb.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            handleDailyBoostOrbClick();
        });
    }
    if (boostScreen) {
        boostScreen.addEventListener('pointermove', (e) => updateDailyBoostOrbPointer(e.clientX, e.clientY));
        boostScreen.addEventListener('pointerleave', () => resetDailyBoostOrbPointer());
    }
    window.addEventListener('resize', () => {
        if (dailyOrbMotion.active) positionDailyBoostOrb();
    });
    if (walletConnectActionBtn) walletConnectActionBtn.addEventListener('click', openTonConnectFlow);
    if (walletDisconnectBtn) walletDisconnectBtn.addEventListener('click', disconnectTonWallet);
    if (walletCopyAddressBtn) walletCopyAddressBtn.addEventListener('click', copyWalletAddress);
    if (walletCopyReferralBtn) walletCopyReferralBtn.addEventListener('click', copyReferralLink);
    if (walletRefreshNftsBtn) {
        walletRefreshNftsBtn.addEventListener('click', () => {
            walletController.fetchWalletNfts().catch(() => { });
        });
    }
    if (shopReceiverSaveBtn) {
        shopReceiverSaveBtn.addEventListener('click', () => {
            const next = shopReceiverInput?.value?.trim() || '';
            setShopTonReceiverAddress(next);
            showMinerToast(next
                ? t('toast.shopReceiverSaved', 'Shop receiver saved')
                : t('toast.shopReceiverCleared', 'Shop receiver cleared'));
        });
    }

    if (navTasksBtn) {
        navTasksBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            setActiveScreen(APP_SCREENS.TASKS);
        });
    }
    if (navBoostBtn) {
        navBoostBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            setActiveScreen(APP_SCREENS.BOOST);
        });
    }
    if (navShopBtn) {
        navShopBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            setActiveScreen(APP_SCREENS.SHOP);
        });
    }
    if (routeConfirmYes) {
        routeConfirmYes.addEventListener('click', () => closeRouteConfirm(true));
    }
    if (routeConfirmNo) {
        routeConfirmNo.addEventListener('click', () => closeRouteConfirm(false));
    }
    if (routeConfirmModal) {
        routeConfirmModal.addEventListener('click', (e) => {
            if (e.target === routeConfirmModal) closeRouteConfirm(false);
        });
    }

    setInterval(miningLoop, 100);
    setInterval(() => {
        updateStats();
        renderDailyBoostOrb();
    }, 1000);
    initTonConnect();
    initRarityAccents();
}

function renderInventory() {
    const isInitialRender = lanesContainer.children.length === 0;

    RARITIES.forEach(rarity => {
        const count = state.inventory[rarity.id];
        let el;

        if (isInitialRender) {
            el = document.createElement('div');
            el.id = `lane-${rarity.id}`;
            el.dataset.rarity = rarity.id;
            el.innerHTML = `
                <div class="nft-icon lane-media">
                    <img class="lane-media-image" src="${rarity.poster}" alt="${rarity.name}" loading="eager" decoding="async" />
                </div>
                <div class="rarity-label">${rarity.name}</div>
                <div class="count-badge"></div>
                <button class="buy-btn" data-buy="${rarity.id}" onclick="window.buyNFT('${rarity.id}')"></button>
            `;
            lanesContainer.appendChild(el);

            el.addEventListener('dragstart', handleDragStart);
            el.addEventListener('dragend', handleDragEnd);
            el.addEventListener('touchstart', handleLaneTouchStart, { passive: false });
            el.addEventListener('touchmove', handleLaneTouchMove, { passive: false });
            el.addEventListener('touchend', handleLaneTouchEnd);
            el.addEventListener('touchcancel', handleLaneTouchCancel);
        } else {
            el = document.getElementById(`lane-${rarity.id}`);
        }

        el.className = `lane-card ${count > 0 ? 'interactive' : 'empty'}`;
        el.draggable = count > 0;

        el.querySelector('.count-badge').textContent = `x${count}`;

        const buyBtn = el.querySelector('.buy-btn');
        buyBtn.textContent = `${t('miner.buyLabel', 'Buy')}: ${Number(rarity.cost || 0)} coins`;
        buyBtn.disabled = false;
    });
}

window.renderInventory = renderInventory;

function renderSlots() {
    const isInitialRender = slotsContainer.children.length === 0;

    RARITIES.forEach(rarity => {
        const isActive = state.activeSlots[rarity.id];
        let el;

        if (isInitialRender) {
            el = document.createElement('div');
            el.id = `slot-${rarity.id}`;
            el.dataset.rarity = rarity.id;

            el.addEventListener('dragover', handleDragOver);
            el.addEventListener('dragleave', handleDragLeave);
            el.addEventListener('drop', handleDrop);

            el.innerHTML = `
                <div class="slot-label">${rarity.name}</div>
                <div class="empty-placeholder"></div>
                <div class="nft-icon slot-media">
                    <img class="slot-media-poster" src="${rarity.poster}" alt="${rarity.name}" loading="eager" decoding="async" />
                    <video class="slot-media-video" muted loop playsinline preload="metadata" poster="${rarity.poster}">
                        <source src="${rarity.slotVideo || rarity.video}" type="video/mp4" />
                    </video>
                </div>
                <div class="multiplier"></div>
                <div class="boost-active-badge">${t('miner.boostActiveBadge', 'BOOST ACTIVE')}</div>
                <button class="remove-btn" onclick="window.removeNFT('${rarity.id}')">&times; ${t('miner.removeBtn', 'Remove')}</button>
                <div class="boost-rate"></div>
            `;
            slotsContainer.appendChild(el);

            const slotVideo = el.querySelector('.slot-media-video');
            if (slotVideo) {
                slotVideo.defaultMuted = true;
                slotVideo.muted = true;
                slotVideo.playsInline = true;
                slotVideo.setAttribute('playsinline', '');
                slotVideo.setAttribute('webkit-playsinline', '');
                slotVideo.setAttribute('muted', '');
            }
        } else {
            el = document.getElementById(`slot-${rarity.id}`);
        }

        applySlotAccent(el, rarity.id);
        el.className = `drop-slot ${isActive > 0 ? 'filled' : 'empty'}`;
        el.querySelector('.multiplier').textContent = `x${isActive}`;
        el.querySelector('.boost-rate').innerHTML = getBoostStackMarkup(rarity, isActive);

        const slotVideo = el.querySelector('.slot-media-video');
        if (slotVideo) {
            if (isActive > 0) {
                slotVideo.play().catch(() => { });
            } else {
                slotVideo.pause();
                try {
                    slotVideo.currentTime = 0;
                } catch (_) { }
            }
        }
    });
}

function pulseSlotHighlight(rarityId) {
    const slotEl = document.getElementById(`slot-${rarityId}`);
    if (!slotEl) return;

    slotEl.classList.remove('slot-just-filled');
    // Restart animation for repeated inserts.
    void slotEl.offsetWidth;
    slotEl.classList.add('slot-just-filled');

    const prevTimer = slotHighlightTimers.get(rarityId);
    if (prevTimer) clearTimeout(prevTimer);

    const nextTimer = setTimeout(() => {
        slotEl.classList.remove('slot-just-filled');
        slotHighlightTimers.delete(rarityId);
    }, 620);
    slotHighlightTimers.set(rarityId, nextTimer);
}

function handleDragStart(e) {
    draggedRarity = this.dataset.rarity;
    this.classList.add('dragging');
    e.dataTransfer.setData('text/plain', draggedRarity);
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd() {
    this.classList.remove('dragging');
    draggedRarity = null;
    document.querySelectorAll('.drop-slot').forEach(slot => {
        slot.classList.remove('drag-over');
    });
}

function handleDragOver(e) {
    e.preventDefault();
    const targetRarity = this.dataset.rarity;

    if (draggedRarity === targetRarity) {
        this.classList.add('drag-over');
        e.dataTransfer.dropEffect = 'move';
    } else {
        e.dataTransfer.dropEffect = 'none';
    }
}

function handleDragLeave() {
    this.classList.remove('drag-over');
}

function handleDrop(e) {
    e.stopPropagation();
    this.classList.remove('drag-over');

    const sourceRarity = e.dataTransfer.getData('text/plain');
    const targetRarity = this.dataset.rarity;

    transferNftToSlot(sourceRarity, targetRarity);
}

function getSlotIndexForRarity(rarityId) {
    return Math.max(0, RARITIES.findIndex((rarity) => rarity.id === rarityId));
}

function transferNftToSlot(sourceRarity, targetRarity) {
    if (!sourceRarity || !targetRarity || sourceRarity !== targetRarity) return false;
    const slotIndex = getSlotIndexForRarity(targetRarity);
    withServerActionPending(`slot-activate-${targetRarity}`, `#slot-${targetRarity}`, async () => {
        try {
            const result = await activateInventorySlot({
                rarityId: targetRarity,
                slotIndex,
                idempotencyKey: createActionIdempotencyKey(`slot-activate-${targetRarity}`)
            });
            applyActionResponse(result);
            playCrystalInsertSound();
            showMinerToast(t('toast.nftInserted', 'NFT boost slot activated'));
            return { ok: true, result };
        } catch (error) {
            showActionError(error, t('toast.slotActivateFailed', 'Failed to activate slot'), 'inventory_activate_slot');
            refreshAuthoritativeState({ persist: false, silent: true }).catch(() => { });
            return { ok: false, reason: error?.code || 'api_error', error };
        }
    });
    return true;
}

function cleanupTouchDrag() {
    if (!touchDragState) return;

    if (touchDragState.ghost && touchDragState.ghost.parentNode) {
        touchDragState.ghost.parentNode.removeChild(touchDragState.ghost);
    }

    if (touchDragState.sourceEl) {
        touchDragState.sourceEl.classList.remove('dragging');
    }

    if (touchDragState.hoverSlot) {
        touchDragState.hoverSlot.classList.remove('drag-over');
    }

    touchDragState = null;
}

function updateTouchDragPosition(clientX, clientY) {
    if (!touchDragState) return;

    if (touchDragState.ghost) {
        touchDragState.ghost.style.left = `${clientX}px`;
        touchDragState.ghost.style.top = `${clientY}px`;
    }

    const elAtPoint = document.elementFromPoint(clientX, clientY);
    const slot = elAtPoint?.closest('.drop-slot') || null;

    if (touchDragState.hoverSlot && touchDragState.hoverSlot !== slot) {
        touchDragState.hoverSlot.classList.remove('drag-over');
    }

    touchDragState.hoverSlot = slot;
    if (slot && slot.dataset.rarity === touchDragState.rarity) {
        slot.classList.add('drag-over');
    } else if (slot) {
        slot.classList.remove('drag-over');
    }
}

function handleLaneTouchStart(e) {
    if (!e.touches || e.touches.length === 0) return;
    if (e.target?.closest('.buy-btn')) return;
    if (state.inventory[this.dataset.rarity] <= 0) return;

    const touch = e.touches[0];
    e.preventDefault();

    const rect = this.getBoundingClientRect();
    const ghost = this.cloneNode(true);
    ghost.classList.add('touch-drag-ghost');
    ghost.style.width = `${Math.max(66, Math.round(rect.width))}px`;
    ghost.style.position = 'fixed';
    ghost.style.left = `${touch.clientX}px`;
    ghost.style.top = `${touch.clientY}px`;
    ghost.style.transform = 'translate(-50%, -50%)';
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '10040';
    ghost.style.opacity = '0.9';
    document.body.appendChild(ghost);

    this.classList.add('dragging');
    draggedRarity = this.dataset.rarity;
    touchDragState = {
        rarity: this.dataset.rarity,
        sourceEl: this,
        ghost,
        hoverSlot: null,
        startX: touch.clientX,
        startY: touch.clientY,
        moved: false
    };

    updateTouchDragPosition(touch.clientX, touch.clientY);
}

function handleLaneTouchMove(e) {
    if (!touchDragState || !e.touches || e.touches.length === 0) return;
    const touch = e.touches[0];
    e.preventDefault();

    if (!touchDragState.moved) {
        const dx = Math.abs(touch.clientX - touchDragState.startX);
        const dy = Math.abs(touch.clientY - touchDragState.startY);
        if (dx > 7 || dy > 7) {
            touchDragState.moved = true;
        }
    }

    updateTouchDragPosition(touch.clientX, touch.clientY);
}

function handleLaneTouchEnd(e) {
    if (!touchDragState) return;

    const sourceRarity = touchDragState.rarity;
    const hoverRarity = touchDragState.hoverSlot?.dataset.rarity || '';

    let inserted = false;
    if (hoverRarity) {
        inserted = transferNftToSlot(sourceRarity, hoverRarity);
    } else if (!touchDragState.moved) {
        // Tap fallback on mobile: quick tap inserts into matching slot.
        inserted = transferNftToSlot(sourceRarity, sourceRarity);
    }

    if (!inserted && !touchDragState.moved) {
        showMinerToast(t('toast.tapCardToInsert', 'Tap card to insert NFT'));
    }

    draggedRarity = null;
    cleanupTouchDrag();
}

function handleLaneTouchCancel() {
    draggedRarity = null;
    cleanupTouchDrag();
}

window.removeNFT = (rarityId) => {
    const slotIndex = getSlotIndexForRarity(rarityId);
    withServerActionPending(`slot-remove-${rarityId}`, `#slot-${rarityId} .remove-btn`, async () => {
        try {
            const result = await removeInventorySlot({
                slotIndex,
                idempotencyKey: createActionIdempotencyKey(`slot-remove-${rarityId}`)
            });
            applyActionResponse(result);
            playRemoveSound();
            showMinerToast(t('toast.nftRemoved', 'NFT removed from slot'));
            return { ok: true, result };
        } catch (error) {
            showActionError(error, t('toast.slotRemoveFailed', 'Failed to remove slot'), 'inventory_remove_slot');
            refreshAuthoritativeState({ persist: false, silent: true }).catch(() => { });
            return { ok: false, reason: error?.code || 'api_error', error };
        }
    });
};

window.buyNFT = async function (rarityId) {
    const rarity = RARITIES.find(r => r.id === rarityId);
    if (!rarity) return;
    const confirmed = await openRouteConfirm(
        t('shop.goConfirm', 'Go to shop to buy {name} for {cost} coins?', {
            name: rarity.name,
            cost: Number(rarity.cost || 0)
        }),
        t('app.confirmTitle', 'Confirm action')
    );
    if (!confirmed) return;
    openShopForRarity(rarityId);
};

function updateStats() {
    let activeCount = 0;

    RARITIES.forEach(rarity => {
        if (state.activeSlots[rarity.id] > 0) {
            activeCount += state.activeSlots[rarity.id];
        }
    });

    const questBoost = getActivatedBoostPerSec();
    const coinBoost = getCoinBoostPerSec();
    const totalBoostPerHour = Number(formatUnitsForDisplay(state.incomePerHourUnits || 0, 6));
    const totalBoostNoNftPerHour = (questBoost + coinBoost) * 3600;
    const coinBoostPerHour = coinBoost * 3600;

    insertedCountEl.textContent = activeCount;
    totalBoostEl.innerHTML = `+${formatBoostPerSec(totalBoostPerHour)} / HOUR &uarr;`;
    if (boostTotalPerSecEl) {
        boostTotalPerSecEl.textContent = `+${formatBoostPerSec(totalBoostNoNftPerHour)} / HOUR`;
    }
    if (boostCoinPerSecEl) {
        boostCoinPerSecEl.textContent = `+${formatBoostPerSec(coinBoostPerHour)} / HOUR`;
    }
}

function miningLoop() {
    const projectedUnits = projectBalanceUnits(state);
    balanceEl.textContent = Number(formatUnitsForDisplay(projectedUnits, 3)).toLocaleString('en-US', {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3
    });
}

function wakeupVideos() {
    const videos = document.querySelectorAll('video');
    videos.forEach(v => {
        if (v.classList.contains('slot-media-video')) {
            const slotEl = v.closest('.drop-slot');
            if (!slotEl || !slotEl.classList.contains('filled')) return;
        }
        if (v.paused) v.play().catch(() => { });
    });
}

document.addEventListener('touchstart', wakeupVideos, { once: true });
document.addEventListener('click', wakeupVideos, { once: true });
document.addEventListener('pointerdown', wakeupVideos, { once: true });

async function bootApp() {
    const splashMin = new Promise((resolve) => setTimeout(resolve, 320));
    initTelegramWebApp();
    await Promise.allSettled([preloadBootAssets(), splashMin]);
    init();
    await refreshAuthoritativeState({ persist: false, silent: true }).catch(() => { });
    await Promise.allSettled([
        tasksController.load({ silent: true }),
        walletController.refreshPaymentsStatus?.()
    ]);
    hidePreloadScreen();
}

bootApp();

const themeToggle = document.getElementById('theme-toggle');
const htmlRoot = document.documentElement;

const savedTheme = readString(STORAGE_KEYS.THEME, '');
if (savedTheme === 'dark') {
    htmlRoot.classList.add('dark');
    if (themeToggle) themeToggle.checked = true;
}

if (themeToggle) {
    themeToggle.addEventListener('change', () => {
        if (themeToggle.checked) {
            htmlRoot.classList.add('dark');
            writeString(STORAGE_KEYS.THEME, 'dark');
        } else {
            htmlRoot.classList.remove('dark');
            writeString(STORAGE_KEYS.THEME, 'light');
        }
    });
}

function setLocale(nextLocale) {
    const normalized = normalizeLocale(nextLocale);
    currentLocale = normalized;
    writeString(STORAGE_KEYS.LANGUAGE, normalized);
    if (langToggle) {
        langToggle.checked = normalized === 'en';
    }
    applyI18nToDom();
    renderInventory();
    renderSlots();
    renderBoostTasks();
    tasksController.render();
    updateWalletUI();
    updateStats();
    window.dispatchEvent(new CustomEvent('app-language-changed', { detail: { locale: normalized } }));
}

window.setAppLocale = setLocale;

if (langToggle) {
    langToggle.addEventListener('change', () => {
        setLocale(langToggle.checked ? 'en' : 'ru');
    });
}




