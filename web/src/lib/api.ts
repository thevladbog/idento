import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8080',
});

// Request interceptor: Add token to all requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: Handle 401 errors (invalid/expired token)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token is invalid or expired, clear auth data and redirect to login
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('tenants');
      localStorage.removeItem('current_tenant');
      
      // Only redirect if we're not already on login/register pages
      if (!window.location.pathname.startsWith('/login') && 
          !window.location.pathname.startsWith('/register') &&
          !window.location.pathname.startsWith('/qr-login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;

