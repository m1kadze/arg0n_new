import { apiRequest, setAuthToken } from './api';
import type { AuthResponse } from './types';

export interface AuthData {
  username: string;
  password: string;
}

export class AuthController {
  public validate(
    data: AuthData,
    isRegister: boolean,
    confirmPassword?: string,
  ): string | null {
    if (!data.username) {
      return 'Введите логин.';
    }
    if (!data.password) {
      return 'Введите пароль.';
    }
    if (isRegister) {
      if (data.username.length < 3) {
        return 'Логин должен быть не короче 3 символов.';
      }
      if (data.password.length < 6) {
        return 'Пароль должен быть не короче 6 символов.';
      }
      if (data.password !== confirmPassword) {
        return 'Пароли не совпадают.';
      }
    }
    return null;
  }

  public async login(data: AuthData): Promise<AuthResponse> {
    const response = await apiRequest<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    setAuthToken(response.access_token);
    return response;
  }

  public async register(data: AuthData): Promise<AuthResponse> {
    const response = await apiRequest<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    setAuthToken(response.access_token);
    return response;
  }

  public logout(): void {
    setAuthToken(null);
  }
}
