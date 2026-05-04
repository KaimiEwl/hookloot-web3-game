function initMinerChat() {
    const chatWidget = document.getElementById('ai-chat-widget');
    const closeBtn = document.getElementById('ai-chat-close');
    const chatWindow = document.getElementById('ai-chat-window');
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('chatSendBtn');
    const chatMessages = document.getElementById('chatMessages');

    if (!chatWidget || !chatWindow || !chatInput || !sendBtn || !chatMessages) return;
    if (chatWindow.dataset.chatReady === '1') return;
    chatWindow.dataset.chatReady = '1';
    let pulseTimer = null;

    const FAQ = {
        ru: [
            {
                keywords: ['как начать', 'как играть', 'что делать', 'с чего начать'],
                answer: 'Начни с вкладки "Кошелек": подключи TON. Затем открой "Магазин", купи NFT, вернись в "Майнер" и перетащи карту в слот той же редкости.'
            },
            {
                keywords: ['кошелек', 'кошелёк', 'подключить', 'ton connect', 'wallet'],
                answer: 'Открой вкладку "Кошелек" и нажми "Подключить TON". После подключения можно покупать NFT в магазине за TON.'
            },
            {
                keywords: ['магазин', 'купить', 'nft'],
                answer: 'NFT покупаются во вкладке "Магазин" за TON. В майнере кнопка "Купить" просто переводит тебя в магазин на нужную карту.'
            },
            {
                keywords: ['майнер', 'добывать', 'доход', 'монеты'],
                answer: 'Во вкладке "Майнер" перетащи купленные NFT в нижние слоты той же редкости. Активные карты увеличивают доход в секунду.'
            },
            {
                keywords: ['буст', 'бусты', 'boost'],
                answer: 'Во вкладке "Boost" можно купить буст за монеты и активировать бусты за коллекцию NFT. Они усиливают общий доход.'
            },
            {
                keywords: ['gold', 'золот', 'голд'],
                answer: 'Каждая Gold NFT усиливает весь доход. Одна Gold дает x5, две Gold дают x10, три Gold дают x15. Они складываются линейно.'
            }
        ],
        en: [
            {
                keywords: ['how to start', 'how to play', 'what to do', 'start'],
                answer: 'Start from the "Wallet" tab: connect TON, open the shop, buy an NFT, then return to the miner and drag the card into the matching slot.'
            },
            {
                keywords: ['wallet', 'connect', 'ton connect'],
                answer: 'Open the "Wallet" tab and press "Connect TON". After that you can buy NFTs in the shop with TON.'
            },
            {
                keywords: ['shop', 'buy', 'nft'],
                answer: 'NFTs are bought in the "Shop" tab with TON. In the miner, the "Buy" button simply takes you to the matching shop card.'
            },
            {
                keywords: ['miner', 'income', 'coins', 'mine'],
                answer: 'In the "Miner" tab drag purchased NFTs into the matching slots below. Active cards increase your income per second.'
            },
            {
                keywords: ['boost', 'boosts'],
                answer: 'In the "Boost" tab you can buy coin boosts and activate NFT collection boosts. They increase total income.'
            },
            {
                keywords: ['gold', 'golden'],
                answer: 'Each Gold NFT boosts total income. One Gold gives x5, two Gold give x10, three Gold give x15. They stack linearly.'
            }
        ]
    };

    function getLocale() {
        return typeof window.getCurrentLocale === 'function' ? window.getCurrentLocale() : 'ru';
    }

    function tr(key, fallback) {
        return typeof window.appTranslate === 'function' ? window.appTranslate(key, fallback) : fallback;
    }

    function openChat() {
        chatWindow.classList.remove('hidden');
        chatWidget.classList.add('is-open');
    }

    function triggerPulse() {
        chatWidget.classList.remove('is-pulsing');
        void chatWidget.offsetWidth;
        chatWidget.classList.add('is-pulsing');
        if (pulseTimer) window.clearTimeout(pulseTimer);
        pulseTimer = window.setTimeout(() => {
            chatWidget.classList.remove('is-pulsing');
        }, 1800);
    }

    function closeChat() {
        chatWindow.classList.add('hidden');
        chatWidget.classList.remove('is-open');
    }

    function appendMessage(text, isUser) {
        const node = document.createElement('div');
        node.className = `message ${isUser ? 'user-message' : 'ai-message'}`;
        node.textContent = text;
        chatMessages.appendChild(node);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function resolveAnswer(message) {
        const locale = getLocale() === 'en' ? 'en' : 'ru';
        const haystack = String(message || '').toLowerCase();
        const faqList = FAQ[locale];
        for (const item of faqList) {
            if (item.keywords.some((keyword) => haystack.includes(keyword))) {
                return item.answer;
            }
        }
        return locale === 'en'
            ? 'I can help with the basics: wallet, shop, miner, boosts and Gold NFT.'
            : 'Я могу помочь с базовыми вещами: кошелек, магазин, майнер, бусты и Gold NFT.';
    }

    function processMessage(rawMessage) {
        const message = String(rawMessage || '').trim();
        if (!message) return;

        openChat();
        triggerPulse();
        appendMessage(message, true);
        chatInput.value = '';

        window.setTimeout(() => {
            appendMessage(resolveAnswer(message), false);
        }, 180);
    }

    chatInput.addEventListener('focus', () => {
        openChat();
        triggerPulse();
    });
    chatInput.addEventListener('pointerdown', () => {
        openChat();
        triggerPulse();
    });
    sendBtn.addEventListener('click', () => processMessage(chatInput.value));
    chatInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            processMessage(chatInput.value);
        }
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', closeChat);
    }

    document.addEventListener('pointerdown', (event) => {
        if (chatWindow.classList.contains('hidden')) return;
        if (chatWidget.contains(event.target)) return;
        closeChat();
    });

    window.addEventListener('app-language-changed', () => {
        const greeting = chatMessages.querySelector('[data-i18n="chat.greeting"]');
        if (greeting) {
            greeting.textContent = tr('chat.greeting', greeting.textContent);
        }
        sendBtn.setAttribute('aria-label', tr('chat.send', 'Send'));
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMinerChat, { once: true });
} else {
    initMinerChat();
}