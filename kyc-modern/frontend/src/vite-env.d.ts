/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_AWS_REGION?: string;
  readonly VITE_COGNITO_IDENTITY_POOL_ID?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
