import React, { useState } from 'react';
import { App as AntdApp, Form, Input, Button, Typography } from 'antd';
import { User, Lock } from 'lucide-react';
import { AuthController } from '../../core/AuthController';
import type { AuthResponse } from '../../core/types';

const { Title, Text } = Typography;

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

  const toggleMode = () => {
    setMode((prev) => (prev === 'login' ? 'register' : 'login'));
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
      if (mode === 'login') {
        const session = await controller.login({ username, password });
        message.success(`С возвращением, ${username}!`);
        onAuthenticated(session);
      } else {
        const session = await controller.register({ username, password });
        message.success(`Аккаунт ${username} создан.`);
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

  const isLogin = mode === 'login';

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '380px',
        textAlign: 'center',
        padding: '0 20px',
      }}
    >
      <Title
        level={2}
        style={{ color: 'white', marginBottom: '8px', fontWeight: 700 }}
      >
        {isLogin ? 'Войти в Arg0n' : 'Регистрация'}
      </Title>

      <Text
        style={{
          color: '#707579',
          display: 'block',
          marginBottom: '32px',
          fontSize: '15px',
        }}
      >
        {isLogin
          ? 'Войдите, чтобы продолжить общение.'
          : 'Создайте аккаунт, чтобы начать переписку.'}
      </Text>

      <Form form={form} onFinish={onFinish} autoComplete="off">
        <div className="tg-input-group">
          <div className="tg-custom-input-wrapper">
            <User size={20} color="#707579" style={{ marginRight: 10 }} />
            <Form.Item<FieldType>
              name="username"
              style={{ margin: 0, width: '100%' }}
            >
              <Input
                placeholder="Логин"
                variant="borderless"
                className="tg-custom-input"
                style={{ height: '40px', padding: 0 }}
              />
            </Form.Item>
          </div>
        </div>

        <div className="tg-input-group">
          <div className="tg-custom-input-wrapper">
            <Lock size={20} color="#707579" style={{ marginRight: 10 }} />
            <Form.Item<FieldType>
              name="password"
              style={{ margin: 0, width: '100%' }}
            >
              <Input.Password
                placeholder="Пароль"
                variant="borderless"
                className="tg-custom-input"
                style={{ height: '40px', padding: 0 }}
              />
            </Form.Item>
          </div>
        </div>

        <div
          className={`auth-confirm-wrap ${!isLogin ? 'is-open' : ''}`}
          aria-hidden={isLogin}
        >
          <div className="tg-input-group" style={{ marginBottom: 0 }}>
            <div className="tg-custom-input-wrapper">
              <Lock size={20} color="#707579" style={{ marginRight: 10 }} />
              <Form.Item<FieldType>
                name="confirmPassword"
                style={{ margin: 0, width: '100%' }}
              >
                <Input.Password
                  placeholder="Подтвердите пароль"
                  variant="borderless"
                  className="tg-custom-input"
                  style={{ height: '40px', padding: 0 }}
                />
              </Form.Item>
            </div>
          </div>
        </div>

        <Form.Item style={{ marginTop: '30px' }}>
          <Button
            type="primary"
            htmlType="submit"
            block
            loading={loading}
            style={{
              height: '54px',
              borderRadius: '14px',
              fontSize: '16px',
              fontWeight: 600,
              boxShadow: 'none',
            }}
          >
            {isLogin ? 'Войти' : 'Создать аккаунт'}
          </Button>
        </Form.Item>
      </Form>

      <div style={{ marginTop: '10px' }}>
        <Text style={{ color: '#707579' }}>
          {isLogin ? 'Нет аккаунта?' : 'Уже есть аккаунт?'}
        </Text>
        <button onClick={toggleMode} className="tg-link-btn" type="button">
          {isLogin ? 'Зарегистрироваться' : 'Войти'}
        </button>
      </div>
    </div>
  );
};
