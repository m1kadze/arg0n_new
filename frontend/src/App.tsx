import React, { Suspense, lazy, useEffect, useState } from 'react';
import { App as AntdApp, ConfigProvider, Spin, theme } from 'antd';
import { AuthController } from './core/AuthController';
import { api, getAuthToken, setAuthToken } from './core/api';
import type { AuthResponse, UserPublic } from './core/types';
import './styles/global.css';

const authController = new AuthController();
const AuthForm = lazy(() =>
  import('./components/templates/AuthForm').then((module) => ({
    default: module.AuthForm,
  })),
);
const ChatScreen = lazy(() =>
  import('./components/templates/ChatScreen').then((module) => ({
    default: module.ChatScreen,
  })),
);

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<UserPublic | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const bootstrap = async () => {
      const token = getAuthToken();
      if (!token) {
        setInitializing(false);
        return;
      }

      try {
        const user = await api.getMe();
        setCurrentUser(user);
      } catch {
        setAuthToken(null);
      } finally {
        setInitializing(false);
      }
    };

    bootstrap();
  }, []);

  const handleAuthenticated = (session: AuthResponse) => {
    setCurrentUser(session.user);
  };

  const handleLogout = () => {
    authController.logout();
    setCurrentUser(null);
  };

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#8774e1',
          colorBgBase: '#212121',
          colorTextBase: '#ffffff',
          fontFamily: 'Roboto, Helvetica, Arial, sans-serif',
        },
        components: {
          Button: {
            colorPrimary: '#8774e1',
            colorPrimaryHover: '#9d8ceb',
          },
        },
      }}
    >
      <AntdApp>
        {initializing ? (
          <div className="app-loading">
            <Spin size="large" />
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="app-loading">
                <Spin size="large" />
              </div>
            }
          >
            {currentUser ? (
              <ChatScreen
                currentUser={currentUser}
                onLogout={handleLogout}
                onProfileUpdated={setCurrentUser}
              />
            ) : (
              <AuthForm
                controller={authController}
                onAuthenticated={handleAuthenticated}
              />
            )}
          </Suspense>
        )}
      </AntdApp>
    </ConfigProvider>
  );
};

export default App;
