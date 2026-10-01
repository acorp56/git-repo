// Вход через Яндекс ID для «Кровинки» — пример на Node.js (Express, Node 18+).
// Схема: кнопка → oauth.yandex.ru/authorize → наш /auth/yandex/callback → обмен кода на токен
// → login.yandex.ru/info → находим или создаём пользователя → своя сессия.
//
// Переменные окружения (из кабинета oauth.yandex.ru):
//   YANDEX_CLIENT_ID, YANDEX_CLIENT_SECRET,
//   YANDEX_REDIRECT_URI = https://krovinka.ru/auth/yandex/callback  (должен совпадать с указанным в кабинете)

import express from 'express';
import crypto from 'node:crypto';
import session from 'express-session';

const app = express();
app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, secure: true, sameSite: 'lax' } }));

const { YANDEX_CLIENT_ID, YANDEX_CLIENT_SECRET, YANDEX_REDIRECT_URI } = process.env;

// 1. Кнопка «Войти с Яндекс ID» ведёт сюда
app.get('/auth/yandex', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');        // защита от CSRF
  req.session.oauthState = state;
  req.session.returnTo = safeReturnTo(req.query.returnTo);      // куда вернуть после входа (например, к SOS)
  const url = new URL('https://oauth.yandex.ru/authorize');
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: YANDEX_CLIENT_ID,
    redirect_uri: YANDEX_REDIRECT_URI,
    state,
    // Права выбираются при регистрации приложения; здесь можно сузить набор:
    // login:info — имя, login:email — почта, login:avatar — аватар, login:default_phone — телефон
    scope: 'login:info login:avatar login:default_phone',
  });
  res.redirect(url.toString());
});

// 2. Яндекс возвращает пользователя с ?code=...&state=...
app.get('/auth/yandex/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect('/login?error=yandex_denied');             // пользователь нажал «Отмена»
  if (!code || state !== req.session.oauthState) return res.redirect('/login?error=bad_state');
  delete req.session.oauthState;

  try {
    // 3. Меняем код на токен (секрет только на сервере, никогда во фронтенде)
    const tokenRes = await fetch('https://oauth.yandex.ru/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code,
        client_id: YANDEX_CLIENT_ID, client_secret: YANDEX_CLIENT_SECRET }),
    });
    if (!tokenRes.ok) throw new Error('token ' + tokenRes.status);
    const { access_token } = await tokenRes.json();

    // 4. Данные профиля
    const infoRes = await fetch('https://login.yandex.ru/info?format=json', {
      headers: { Authorization: `OAuth ${access_token}` },
    });
    if (!infoRes.ok) throw new Error('info ' + infoRes.status);
    const y = await infoRes.json();

    // 5. Находим или создаём пользователя. Ключ — y.id (стабильный идентификатор в Яндексе)
    const user = await upsertUser({
      provider: 'yandex',
      providerId: y.id,
      name: y.first_name || y.display_name || y.login,
      phone: y.default_phone?.number ?? null,                  // подтверждённый телефон: СМС-вход не нужен
      avatar: y.is_avatar_empty ? null
        : `https://avatars.yandex.net/get-yapic/${y.default_avatar_id}/islands-200`,
    });

    const returnTo = safeReturnTo(req.session.returnTo);        // regenerate очищает сессию, сохраняем заранее
    req.session.regenerate(err => {                             // новая сессия после входа
      if (err) return res.redirect('/login?error=session');
      req.session.userId = user.id;
      res.redirect(returnTo);
    });
  } catch (e) {
    console.error('Yandex ID login failed', e);
    res.redirect('/login?error=yandex_unavailable');            // на экране входа: «Яндекс не ответил, попробуйте ещё раз»
  }
});

// Только относительный путь внутри сайта, иначе ссылка вида ?returnTo=https://чужой-сайт
// уведёт пользователя после входа на чужой сайт (открытый редирект).
function safeReturnTo(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) return '/';
  // //evil.ru, /\evil.ru и /<таб>/evil.ru браузер считает ссылкой на другой хост
  if (value.startsWith('//') || /[\\\x00-\x1f]/.test(value)) return '/';
  return value;
}

// Заглушка: заменить на запрос к вашей базе (PostgreSQL и т. п.)
async function upsertUser(profile) {
  return { id: `${profile.provider}:${profile.providerId}`, ...profile };
}

app.listen(3000);
