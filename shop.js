import { APP_EVENTS, APP_SCREENS, RARITY_COLORS } from './src/core/constants.js';
import { getBridge } from './src/core/bridge.js';
import {
    getSignedCarouselOffset,
    getSwipeAxisLock,
    getSwipeThreshold
} from './src/modules/shop/carouselMath.js';

const screenShop = document.getElementById('screenShop');
const shopTunnelIntro = document.getElementById('shopTunnelIntro');
const shopCarouselContainer = document.getElementById('shopCarouselContainer');
const shopCarouselTrack = document.getElementById('shopCarouselTrack');
const carouselContainer = document.querySelector('.carousel-container');
const shopDots = document.getElementById('shopDots');
const shopNftName = document.getElementById('shopNftName');
const shopNftDesc = document.getElementById('shopNftDesc');
const shopBuyBtn = document.getElementById('shopBuyBtn');
const shopBalanceUI = document.getElementById('shop-balance');
const aiChatWidget = document.getElementById('ai-chat-widget');

const shopConfirmModal = document.getElementById('shopConfirmModal');
const shopConfirmTitle = document.getElementById('shopConfirmTitle');
const shopConfirmPrice = document.getElementById('shopConfirmPrice');
const shopConfirmYes = document.getElementById('shopConfirmYes');
const shopConfirmNo = document.getElementById('shopConfirmNo');

const leftArrow = document.querySelector('.nav-arrow.left');
const rightArrow = document.querySelector('.nav-arrow.right');

let isAnimating = false;
let currentCarouselIndex = 0;
let shopRarities = [];
let suppressCardClick = false;
let shopVideosPrimed = false;
let shopVideosGestureUnlocked = false;
let carouselStepTimer = null;
let shopPurchasePending = false;
let shopTunnelTimer = null;
let lastScreenSeen = APP_SCREENS.MINER;

let swipePointerId = null;
let swipeStartX = 0;
let swipeStartY = 0;
let swipeLastX = 0;
let swipeLastY = 0;
let swipePointerType = '';

function t(key, fallback, vars = {}) {
    const translate = window.appTranslate;
    if (typeof translate === 'function') {
        return translate(key, fallback, vars);
    }
    let text = fallback || key;
    Object.entries(vars).forEach(([name, value]) => {
        text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
    });
    return text;
}

function isShopActive() {
    return !!screenShop && screenShop.classList.contains('is-active');
}

function getCoinBalance() {
    const fn = getBridge()?.game?.getBalance;
    if (typeof fn === 'function') return Number(fn() || 0);
    return 0;
}

function showToast(message) {
    const fn = getBridge()?.ui?.showToast;
    if (typeof fn === 'function') return fn(message);
    if (typeof window.showMinerToast === 'function') return window.showMinerToast(message);
}

function playPurchaseSound() {
    const fn = getBridge()?.audio?.playPurchaseSound;
    if (typeof fn === 'function') return fn();
    if (typeof window.playPurchaseSound === 'function') return window.playPurchaseSound();
    if (typeof window.playCashDing === 'function') return window.playCashDing();
}

async function purchaseWithBalance(rarity) {
    const fn = getBridge()?.shop?.purchaseWithBalance;
    if (typeof fn === 'function') return fn(rarity);
    if (typeof window.purchaseShopItemWithBalance === 'function') return window.purchaseShopItemWithBalance(rarity);
    return { ok: false, reason: 'not_available' };
}

function getRarityColor(rarityId) {
    return RARITY_COLORS[rarityId] || '#FFFFFF';
}

function formatBoostValue(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return '0';
    const abs = Math.abs(num);
    const fixed = abs >= 1 ? num.toFixed(2) : abs >= 0.01 ? num.toFixed(3) : num.toFixed(4);
    return fixed.replace(/\.0+$|(\.\d*?[1-9])0+$/, '$1');
}

function formatTonCost(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return '0';
    if (Number.isInteger(num)) return String(num);
    return num.toFixed(3).replace(/\.0+$|(\.\d*?[1-9])0+$/, '$1');
}

function normalizeChatDock() {
    if (!aiChatWidget) return;
    aiChatWidget.classList.remove('in-shop');
}

function stopShopTunnelIntro() {
    if (shopTunnelTimer) {
        clearTimeout(shopTunnelTimer);
        shopTunnelTimer = null;
    }
    if (shopTunnelIntro) {
        shopTunnelIntro.classList.remove('active');
        shopTunnelIntro.classList.add('hidden');
    }
    if (shopCarouselContainer) {
        shopCarouselContainer.classList.remove('shop-content-hidden');
    }
}

function playShopTunnelIntro() {
    if (!shopTunnelIntro || !shopCarouselContainer) return;

    stopShopTunnelIntro();
    shopCarouselContainer.classList.add('shop-content-hidden');
    shopTunnelIntro.classList.remove('hidden');
    // Restart css animation on each shop entry.
    void shopTunnelIntro.offsetWidth;
    requestAnimationFrame(() => {
        shopTunnelIntro.classList.add('active');
    });

    shopTunnelTimer = setTimeout(() => {
        shopTunnelIntro.classList.remove('active');
        shopTunnelIntro.classList.add('hidden');
        shopCarouselContainer.classList.remove('shop-content-hidden');
        updateCarousel(currentCarouselIndex);
        updateShopUI();
        syncShopVideosPlayback();
        shopTunnelTimer = null;
    }, 1180);
}

function configureShopVideo(video) {
    if (!video) return;
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('muted', '');
    video.setAttribute('autoplay', '');
    video.setAttribute('loop', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
}

function primeShopVideos() {
    const videos = document.querySelectorAll('#shopCarouselTrack .nft-video');
    if (videos.length === 0) return;

    videos.forEach((video) => {
        configureShopVideo(video);
    });

    if (shopVideosPrimed) return;
    shopVideosPrimed = true;
    videos.forEach((video) => {
        try {
            video.load();
        } catch (_) { }
    });
}

function unlockShopVideosOnGesture() {
    if (shopVideosGestureUnlocked) return;
    const videos = Array.from(document.querySelectorAll('#shopCarouselTrack .nft-video'));
    if (videos.length === 0) return;

    let unlockedAny = false;
    const attempts = videos.map((video) => {
        configureShopVideo(video);
        return video.play().then(() => {
            unlockedAny = true;
        }).catch(() => { });
    });

    Promise.allSettled(attempts).then(() => {
        if (unlockedAny) {
            shopVideosGestureUnlocked = true;
            syncShopVideosPlayback();
        }
    });
}

function syncShopVideosPlayback() {
    const videos = document.querySelectorAll('#shopCarouselTrack .nft-video');
    const canRun = isShopActive();
    videos.forEach((video) => {
        configureShopVideo(video);
        if (canRun) {
            video.play().catch(() => { });
        } else {
            video.pause();
        }
    });
}

function updateShopUI() {
    if (!shopRarities.length) return;

    const coinBalance = getCoinBalance();
    if (shopBalanceUI) {
        shopBalanceUI.textContent = coinBalance.toLocaleString('en-US', {
            minimumFractionDigits: 3,
            maximumFractionDigits: 3
        });
    }

    const canBuy = !shopPurchasePending;

    if (shopBuyBtn) {
        if (canBuy) {
            shopBuyBtn.removeAttribute('disabled');
        } else {
            shopBuyBtn.setAttribute('disabled', 'true');
        }
    }
}

function renderCarouselItems() {
    if (!shopCarouselTrack || !shopDots) return;
    shopCarouselTrack.innerHTML = '';
    shopDots.innerHTML = '';

    shopRarities.forEach((rarity, i) => {
        const card = document.createElement('div');
        card.className = 'card';
        card.dataset.index = i;
        card.dataset.rarity = rarity.id;

        const color = getRarityColor(rarity.id);
        card.innerHTML = `<div class="nft-box" style="
            border: 2px solid ${color};
            box-shadow: 0 0 15px ${color};
            display: flex; align-items: center; justify-content: center; overflow: hidden;
            background-color: #000;
            width: 100%; height: 100%; border-radius: 15px;
        ">
            <img class="nft-poster-fallback" src="${rarity.poster}" alt="${rarity.name}">
            <video class="nft-video" autoplay loop muted playsinline preload="auto" poster="${rarity.poster}" src="${rarity.video}" style="width: 100%; height: 100%; object-fit: contain; pointer-events: none; border-radius: 12px;"></video>
        </div>`;

        const videoEl = card.querySelector('.nft-video');
        const posterEl = card.querySelector('.nft-poster-fallback');
        if (videoEl && posterEl) {
            configureShopVideo(videoEl);
            const markReady = () => {
                card.classList.add('video-ready');
                posterEl.classList.add('hidden');
                if (i === currentCarouselIndex && isShopActive()) {
                    videoEl.play().catch(() => { });
                }
            };

            videoEl.addEventListener('loadeddata', markReady, { once: true });
            videoEl.addEventListener('canplay', markReady, { once: true });
            videoEl.addEventListener('playing', markReady, { once: true });
            videoEl.addEventListener('error', () => card.classList.add('video-error'));
            try { videoEl.load(); } catch (_) { }
        }

        card.addEventListener('click', (event) => {
            event.stopPropagation();
            if (suppressCardClick) return;
            moveCarouselToIndex(i);
        });
        shopCarouselTrack.appendChild(card);

        const dot = document.createElement('div');
        dot.className = 'dot';
        dot.dataset.index = i;
        dot.addEventListener('click', () => updateCarousel(i));
        shopDots.appendChild(dot);
    });
}

function rotateCarouselBy(direction, steps = 1) {
    if (!Number.isFinite(direction) || direction === 0) return;
    const safeSteps = Math.max(1, Math.floor(Math.abs(steps)));
    if (carouselStepTimer) {
        clearTimeout(carouselStepTimer);
        carouselStepTimer = null;
    }

    let done = 0;
    const tick = () => {
        updateCarousel(currentCarouselIndex + (direction > 0 ? 1 : -1));
        done += 1;
        if (done < safeSteps) {
            carouselStepTimer = setTimeout(tick, 250);
        } else {
            carouselStepTimer = null;
        }
    };
    tick();
}

function moveCarouselToIndex(targetIndex) {
    const total = shopRarities.length;
    if (total === 0) return;
    const offset = getSignedCarouselOffset(targetIndex, currentCarouselIndex, total);
    if (offset === 0) return;
    rotateCarouselBy(offset > 0 ? 1 : -1, Math.abs(offset));
}

function updateCarousel(newIndex) {
    if (shopRarities.length === 0 || isAnimating) return;
    isAnimating = true;

    const cards = document.querySelectorAll('#shopCarouselTrack .card');
    const dots = document.querySelectorAll('#shopDots .dot');
    currentCarouselIndex = (newIndex + cards.length) % cards.length;

    cards.forEach((card, i) => {
        const offset = getSignedCarouselOffset(i, currentCarouselIndex, cards.length);
        card.classList.remove('center', 'left-1', 'right-1', 'left-2', 'right-2', 'hidden');

        if (offset === 0) card.classList.add('center');
        else if (offset === -1) card.classList.add('left-1');
        else if (offset === 1) card.classList.add('right-1');
        else if (offset === -2) card.classList.add('left-2');
        else if (offset === 2) card.classList.add('right-2');
        else card.classList.add('hidden');
    });

    dots.forEach((dot, i) => dot.classList.toggle('active', i === currentCarouselIndex));
    syncShopVideosPlayback();

    if (shopNftName) shopNftName.style.opacity = '0';
    if (shopNftDesc) shopNftDesc.style.opacity = '0';
    if (shopBuyBtn) shopBuyBtn.style.opacity = '0';

    setTimeout(() => {
        const rarity = shopRarities[currentCarouselIndex];
        if (shopNftName) {
            shopNftName.textContent = rarity.name;
            shopNftName.style.color = getRarityColor(rarity.id);
            shopNftName.style.opacity = '1';
        }
        if (shopNftDesc) {
            if (rarity.id === 'gold') {
                const multiplier = Math.max(1, Number(rarity.incomeMultiplier || 1));
                shopNftDesc.innerHTML = `<span class="shop-boost-value">x${formatBoostValue(multiplier)}</span><span class="shop-boost-unit">${t('boost.incomeUnit', 'income')}</span>`;
            } else {
                shopNftDesc.innerHTML = `<span class="shop-boost-value">+${formatBoostValue(rarity.boost)}</span><span class="shop-boost-unit">sec</span>`;
            }
            shopNftDesc.style.opacity = '1';
        }
        if (shopBuyBtn) {
            const coinCost = Number(rarity?.cost ?? 0);
            shopBuyBtn.textContent = t('shop.buyBtn', 'BUY - {cost} COINS', { cost: formatTonCost(coinCost) });
            shopBuyBtn.style.opacity = '1';
        }

        updateShopUI();
        syncShopVideosPlayback();
    }, 120);

    setTimeout(() => {
        isAnimating = false;
    }, 240);
}

function onCarouselPointerDown(e) {
    if (!isShopActive()) return;
    if (!shopCarouselContainer || shopCarouselContainer.style.display === 'none') return;
    const cardEl = e.target?.closest?.('.card');
    if (!cardEl) return;
    if (e.target?.closest('.nav-arrow, .dot, .shop-buy-btn, .shop-confirm-content, #ai-chat-widget')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    swipePointerId = e.pointerId;
    swipeStartX = e.clientX;
    swipeStartY = e.clientY;
    swipeLastX = e.clientX;
    swipeLastY = e.clientY;
    swipePointerType = e.pointerType || 'touch';
    if (shopCarouselTrack?.setPointerCapture) {
        try { shopCarouselTrack.setPointerCapture(e.pointerId); } catch (_) { }
    }

    unlockShopVideosOnGesture();
    syncShopVideosPlayback();
}

function onCarouselPointerMove(e) {
    if (swipePointerId !== e.pointerId) return;
    swipeLastX = e.clientX;
    swipeLastY = e.clientY;
}

function onCarouselPointerEnd(e) {
    if (swipePointerId === null || swipePointerId !== e.pointerId) return;
    if (shopCarouselTrack?.releasePointerCapture) {
        try { shopCarouselTrack.releasePointerCapture(swipePointerId); } catch (_) { }
    }

    const endX = Number.isFinite(e.clientX) ? e.clientX : swipeLastX;
    const endY = Number.isFinite(e.clientY) ? e.clientY : swipeLastY;
    const dx = endX - swipeStartX;
    const dy = endY - swipeStartY;
    const axisLockPx = getSwipeAxisLock(swipePointerType);
    const thresholdPx = getSwipeThreshold(swipePointerType);

    if (Math.abs(dx) >= thresholdPx && Math.abs(dx) > Math.abs(dy) + axisLockPx) {
        rotateCarouselBy(dx < 0 ? 1 : -1, 1);
        suppressCardClick = true;
        setTimeout(() => {
            suppressCardClick = false;
        }, 220);
    }

    swipePointerId = null;
}

function onCarouselAreaClick(e) {
    if (!isShopActive()) return;
    if (!carouselContainer || !carouselContainer.contains(e.target)) return;
    if (suppressCardClick) return;
    if (e.target?.closest('.card, .dot, .shop-buy-btn, .shop-confirm-content, #ai-chat-widget')) return;

    const rect = carouselContainer.getBoundingClientRect();
    if (rect.width <= 0) return;
    const localX = e.clientX - rect.left;
    const midpoint = rect.width / 2;
    rotateCarouselBy(localX >= midpoint ? 1 : -1, 1);
}

function handleScreenChanged(detail) {
    const nextScreen = detail?.screen || APP_SCREENS.MINER;
    normalizeChatDock();
    if (nextScreen === APP_SCREENS.SHOP && lastScreenSeen !== APP_SCREENS.SHOP) {
        primeShopVideos();
        playShopTunnelIntro();
    } else {
        stopShopTunnelIntro();
        if (shopConfirmModal) shopConfirmModal.classList.remove('active');
        syncShopVideosPlayback();
    }
    lastScreenSeen = nextScreen;
}

function initShop() {
    if (!window.RARITIES || window.RARITIES.length === 0) {
        setTimeout(initShop, 50);
        return;
    }

    shopRarities = window.RARITIES;
    renderCarouselItems();
    updateCarousel(0);
    updateShopUI();
    normalizeChatDock();

    if (leftArrow) leftArrow.addEventListener('click', () => updateCarousel(currentCarouselIndex - 1));
    if (rightArrow) rightArrow.addEventListener('click', () => updateCarousel(currentCarouselIndex + 1));

    if (shopCarouselTrack) {
        shopCarouselTrack.addEventListener('pointerdown', onCarouselPointerDown);
        shopCarouselTrack.addEventListener('pointermove', onCarouselPointerMove);
        shopCarouselTrack.addEventListener('pointerup', onCarouselPointerEnd);
        shopCarouselTrack.addEventListener('pointercancel', onCarouselPointerEnd);
    }

    if (carouselContainer) {
        carouselContainer.addEventListener('click', onCarouselAreaClick);
    }

    document.addEventListener('keydown', (e) => {
        if (!isShopActive()) return;

        if (e.key === 'ArrowLeft') {
            updateCarousel(currentCarouselIndex - 1);
        } else if (e.key === 'ArrowRight') {
            updateCarousel(currentCarouselIndex + 1);
        } else if (e.key === 'Escape') {
            if (typeof window.setActiveScreen === 'function') {
                window.setActiveScreen(APP_SCREENS.MINER);
            }
        }
    });

    if (shopBuyBtn) {
        shopBuyBtn.addEventListener('click', () => {
            if (shopPurchasePending) return;
            const rarity = shopRarities[currentCarouselIndex];
            const coinCost = Number(rarity?.cost ?? 0);

            if (shopConfirmTitle) shopConfirmTitle.textContent = t('shop.confirm.title', 'Buy {name}?', { name: rarity.name });
            if (shopConfirmPrice) shopConfirmPrice.textContent = t('shop.confirm.cost', 'Cost: {cost} coins', { cost: formatTonCost(coinCost) });
            if (shopConfirmModal) shopConfirmModal.classList.add('active');
        });
    }

    if (shopConfirmNo) {
        shopConfirmNo.addEventListener('click', () => {
            if (shopConfirmModal) shopConfirmModal.classList.remove('active');
        });
    }

    if (shopConfirmYes) {
        shopConfirmYes.addEventListener('click', async () => {
            if (shopPurchasePending) return;
            const rarity = shopRarities[currentCarouselIndex];
            if (!rarity) return;

            shopPurchasePending = true;
            shopConfirmYes.setAttribute('disabled', 'true');
            if (shopConfirmNo) shopConfirmNo.setAttribute('disabled', 'true');
            if (shopConfirmPrice) shopConfirmPrice.textContent = t('shop.confirm.wait', 'Buying NFT...');

            const result = await purchaseWithBalance(rarity);

            shopPurchasePending = false;
            shopConfirmYes.removeAttribute('disabled');
            if (shopConfirmNo) shopConfirmNo.removeAttribute('disabled');

            if (result?.ok) {
                playPurchaseSound();
                if (shopConfirmModal) shopConfirmModal.classList.remove('active');
                showToast(t('shop.toast.purchased', '{name} purchased', { name: rarity.name }));
                updateShopUI();
                syncShopVideosPlayback();
                return;
            }

            const reason = result?.reason || '';
            if (result?.message) showToast(result.message);
            else if (reason === 'insufficient_balance') showToast(t('shop.toast.notEnoughTon', 'Not enough coins'));
            else if (reason === 'server_action_pending') showToast(t('toast.serverActionPending', 'This action will sync through the server'));
            else if (reason === 'rejected') showToast(t('shop.toast.rejected', 'Transaction rejected'));
            else showToast(t('shop.toast.failed', 'Purchase failed'));

            const coinCost = Number(rarity?.cost ?? 0);
            if (shopConfirmPrice) shopConfirmPrice.textContent = t('shop.confirm.cost', 'Cost: {cost} coins', { cost: formatTonCost(coinCost) });
        });
    }

    setInterval(() => {
        if (isShopActive()) updateShopUI();
    }, 500);

    window.addEventListener(APP_EVENTS.SCREEN_CHANGED, (e) => handleScreenChanged(e?.detail || {}));
    window.addEventListener('shop-open-rarity', (e) => {
        const rarityId = e?.detail?.rarityId;
        if (!rarityId || !shopRarities.length) return;
        const targetIndex = shopRarities.findIndex((rarity) => rarity.id === rarityId);
        if (targetIndex >= 0) {
            updateCarousel(targetIndex);
        }
    });
    window.addEventListener('app-language-changed', () => {
        updateCarousel(currentCarouselIndex);
        updateShopUI();
    });

    handleScreenChanged({ screen: screenShop?.classList.contains('is-active') ? APP_SCREENS.SHOP : APP_SCREENS.MINER });
}

initShop();
