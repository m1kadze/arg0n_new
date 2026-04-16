import React, { useState } from 'react';
import { App as AntdApp, Form, Input } from 'antd';
import { AuthController } from '../../core/AuthController';
import type { AuthResponse } from '../../core/types';

interface AuthFormProps {
  controller: AuthController;
  onAuthenticated: (session: AuthResponse) => void;
}

type FieldType = {
  username?: string;
  password?: string;
  confirmPassword?: string;
};

export const AuthForm: React.FC<AuthFormProps> = ({
  controller,
  onAuthenticated,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const { message } = AntdApp.useApp();

  const isLogin = mode === 'login';

  const switchMode = (next: 'login' | 'register') => {
    if (next === mode) return;
    setMode(next);
    form.resetFields();
  };

  const onFinish = async (values: FieldType) => {
    const username = values.username || '';
    const password = values.password || '';

    const error = controller.validate(
      { username, password },
      mode === 'register',
      values.confirmPassword,
    );

    if (error) {
      message.error(error);
      return;
    }

    setLoading(true);
    try {
      if (isLogin) {
        const session = await controller.login({ username, password });
        message.success(`С возвращением, ${username}`);
        onAuthenticated(session);
      } else {
        const session = await controller.register({ username, password });
        message.success(`Аккаунт ${username} создан`);
        onAuthenticated(session);
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        message.error(err.message);
      } else {
        message.error(String(err));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell">
      {/* Ambient background orb */}
      <div className="auth-orb" aria-hidden>
        <div className="auth-orb__core" />
        <div className="auth-orb__ring" />
      </div>
      <div className="auth-grid" aria-hidden />
      <div className="auth-noise" aria-hidden />

      {/* Floating satellite pills */}
      <div className="auth-sat auth-sat--tl" aria-hidden>
        <span className="auth-sat__dot" />
        signal.ok
      </div>
      <div className="auth-sat auth-sat--tr" aria-hidden>
        relay · tokyo-02
      </div>
      <div className="auth-sat auth-sat--bl" aria-hidden>
        v0.0.1
      </div>
      <div className="auth-sat auth-sat--br" aria-hidden>
        wss · secured
      </div>

      {/* Central panel */}
      <section className="auth-panel" aria-labelledby="auth-heading">
        <header className="auth-brand">
          <div className="auth-brand__mark">
            <span className="auth-brand__glyph">a</span>
          </div>
          <div className="auth-brand__meta">
            <h1 id="auth-heading" className="auth-brand__title">
              arg0n
            </h1>
            <span className="auth-brand__sub">encrypted · private</span>
          </div>
        </header>

        <div className="auth-switch" role="tablist">
          <button
            role="tab"
            aria-selected={isLogin}
            type="button"
            className={`auth-switch__btn ${isLogin ? 'is-active' : ''}`}
            onClick={() => switchMode('login')}
          >
            Вход
          </button>
          <button
            role="tab"
            aria-selected={!isLogin}
            type="button"
            className={`auth-switch__btn ${!isLogin ? 'is-active' : ''}`}
            onClick={() => switchMode('register')}
          >
            Регистрация
          </button>
          <span
            className="auth-switch__thumb"
            data-pos={isLogin ? 'left' : 'right'}
            aria-hidden
          />
        </div>

        <p className="auth-lede">
          {isLogin
            ? 'Продолжите разговор с того места, где остановились.'
            : 'Создайте аккаунт — это займёт пару секунд.'}
        </p>

        <Form
          form={form}
          onFinish={onFinish}
          autoComplete="off"
          className="auth-form"
          layout="vertical"
          requiredMark={false}
        >
          <Form.Item<FieldType>
            name="username"
            label={<span className="auth-label">имя пользователя</span>}
          >
            <Input
              variant="borderless"
              className="auth-input"
              placeholder="nikita"
              autoComplete="off"
            />
          </Form.Item>

          <Form.Item<FieldType>
            name="password"
            label={<span className="auth-label">пароль</span>}
          >
            <Input.Password
              variant="borderless"
              className="auth-input"
              placeholder="••••••••"
              autoComplete="off"
            />
          </Form.Item>

          <div
            className={`auth-confirm ${!isLogin ? 'is-open' : ''}`}
            aria-hidden={isLogin}
          >
            <Form.Item<FieldType>
              name="confirmPassword"
              label={<span className="auth-label">подтвердите пароль</span>}
            >
              <Input.Password
                variant="borderless"
                className="auth-input"
                placeholder="••••••••"
                autoComplete="off"
              />
            </Form.Item>
          </div>

          <button
            type="submit"
            className={`auth-cta ${loading ? 'is-loading' : ''}`}
            disabled={loading}
          >
            <span className="auth-cta__label">
              {isLogin ? 'Войти' : 'Создать аккаунт'}
            </span>
            <span className="auth-cta__arrow" aria-hidden>
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3.75 9h10.5" />
                <path d="M9 3.75 14.25 9 9 14.25" />
              </svg>
            </span>
            <span className="auth-cta__spinner" aria-hidden />
          </button>
        </Form>

        <footer className="auth-footer">
          <span className="auth-footer__dot" />
          <span>
            {isLogin
              ? 'Нет аккаунта? '
              : 'Уже есть аккаунт? '}
            <button
              type="button"
              className="auth-footer__link"
              onClick={() => switchMode(isLogin ? 'register' : 'login')}
            >
              {isLogin ? 'регистрация' : 'вход'}
            </button>
          </span>
        </footer>
      </section>
    </div>
  );
};
