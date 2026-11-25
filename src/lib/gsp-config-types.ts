/** Shared shape for a tenant's decrypted GSP configuration. */
export interface TenantGspConfig {
  tenantId: string
  gspCode: string
  gspClientId: string
  gspClientSecret: string
  gspUsername: string
  gspPassword: string
  irpEnv: string
}
