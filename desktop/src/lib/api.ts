import axios from "axios";
import { getBackendUrl } from "./config";

function createApi() {
  const api = axios.create({
    baseURL: getBackendUrl(),
  });

  api.interceptors.request.use((config) => {
    config.baseURL = getBackendUrl();
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  api.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response?.status === 401) {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        localStorage.removeItem("tenants");
        localStorage.removeItem("current_tenant");
      }
      return Promise.reject(error);
    }
  );

  return api;
}

export const api = createApi();
