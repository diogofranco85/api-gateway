/**
 * Lista de campos sensíveis que serão mascarados nos logs
 * 
 * Adicione aqui qualquer campo que contenha informações sensíveis.
 * A comparação é case-insensitive e verifica se o nome do campo CONTÉM
 * alguma das strings abaixo.
 * 
 * Exemplo: 'password' vai mascarar 'password', 'user_password', 'Password', etc.
 */
export const SENSITIVE_FIELDS = [
  // Autenticação
  'password',
  'senha',
  'passcode',
  'secret',
  'api_key',
  'apikey',
  'api-key',
  'private_key',
  'privatekey',
  
  // Tokens
  'token',
  'access_token',
  'refresh_token',
  'bearer',
  'authorization',
  'auth',
  'jwt',
  
  // OTP e códigos
  'otp',
  'otpcode',
  'otp_code',
  'otp-code',
  'verification_code',
  'verify_code',
  'pin',
  'code',
  
  // Dados pessoais
  'cpf',
  'ssn',
  'social_security',
  'passport',
  'driver_license',
  'rg',
  
  // Dados financeiros
  'credit_card',
  'creditcard',
  'card_number',
  'cardnumber',
  'cvv',
  'cvc',
  'card_cvv',
  'expiry',
  'account_number',
  'routing_number',
  'bank_account',
  
  // Outros
  'session',
  'session_id',
  'cookie',
  'csrf',
  'nonce',
];

/**
 * Adiciona campos sensíveis customizados à lista padrão
 */
export function addSensitiveFields(fields: string[]): string[] {
  return [...new Set([...SENSITIVE_FIELDS, ...fields])];
}

