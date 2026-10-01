'use client';
import { safeReturnTo } from '@krovinka/core';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Field, Top } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

const ERRORS: Record<string, string> = {
  yandex_denied: 'Вход через Яндекс отменён',
  bad_state: 'Сессия входа устарела. Попробуйте ещё раз',
  yandex_unavailable: 'Яндекс не ответил, попробуйте ещё раз',
  already_linked: 'Этот аккаунт Яндекса уже привязан к другому профилю',
};

const TG_BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT;

function Login() {
  const params = useSearchParams();
  const router = useRouter();
  const { me, reload } = useSession();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const [consent, setConsent] = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [resendIn, setResendIn] = useState(0);
  const [error, setError] = useState(ERRORS[params.get('error') ?? ''] ?? '');
  const [busy, setBusy] = useState(false);
  const tgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (me) router.replace(returnTo);
  }, [me, returnTo, router]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // Telegram Login Widget: после входа виджет вызывает window.onTelegramAuth с подписанными данными.
  useEffect(() => {
    if (!TG_BOT || !tgRef.current || !consent) return;
    (window as unknown as { onTelegramAuth: (u: object) => void }).onTelegramAuth = async (user) => {
      try {
        await api('/auth/telegram', { body: { ...user, consent: true } });
        await reload();
      } catch (e) {
        setError((e as ApiError).message);
      }
    };
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-widget.js?22';
    s.async = true;
    s.dataset.telegramLogin = TG_BOT;
    s.dataset.size = 'large';
    s.dataset.radius = '20';
    s.dataset.onauth = 'onTelegramAuth(user)';
    s.dataset.requestAccess = 'write'; // чтобы бот мог присылать SOS
    tgRef.current.replaceChildren(s);
  }, [consent, reload]);

  async function start(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api<{ resendIn: number }>('/auth/phone/start', { body: { phone } });
      setStep('code');
      setResendIn(r.resendIn);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/phone/verify', { body: { phone, code, consent } });
      await reload();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Top back="/" />
      <h1 className="page-title">Вход</h1>
      <p className="muted" style={{ marginBottom: 16 }}>
        Чтобы создать SOS или стать донором.
      </p>
      {error && (
        <p className="alarm" role="alert" style={{ marginBottom: 12 }}>
          {error}
        </p>
      )}

      <label className="check" style={{ marginBottom: 16 }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span className="small">
          Согласен(на) на обработку персональных данных и с <a href="/privacy">политикой конфиденциальности</a>. Телефон увидит только тот, с кем вы договоритесь о сдаче
          крови.
        </span>
      </label>

      <div className="stack" aria-disabled={!consent} style={consent ? undefined : { opacity: 0.5, pointerEvents: 'none' }}>
        {TG_BOT && <div ref={tgRef} style={{ minHeight: 44 }} />}
        <a className="btn ya wide" href={`/api/auth/yandex?consent=1&returnTo=${encodeURIComponent(returnTo)}`}>
          Войти с Яндекс ID
        </a>

        <div className="card stack">
          {step === 'phone' ? (
            <form className="stack" onSubmit={start}>
              <Field id="phone" label="Или по номеру телефона">
                <input id="phone" className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="+7 900 000-00-00" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
              <button className="btn primary" disabled={busy || !phone}>
                Получить код
              </button>
            </form>
          ) : (
            <form className="stack" onSubmit={verify}>
              <Field id="code" label={`Код из СМС на ${phone}`}>
                <input id="code" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
              </Field>
              <button className="btn primary" disabled={busy || code.length !== 4}>
                Войти
              </button>
              <div className="row between">
                <button type="button" className="link-btn" onClick={() => setStep('phone')}>
                  Другой номер
                </button>
                <button type="button" className="link-btn" disabled={resendIn > 0 || busy} onClick={() => start()}>
                  {resendIn > 0 ? `Отправить снова через ${resendIn} с` : 'Отправить код снова'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}
