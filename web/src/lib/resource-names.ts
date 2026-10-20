import { InstanceSetting_Key } from "@/types/proto/api/instance_service_pb";
import { UserSetting_Key } from "@/types/proto/api/user_service_pb";

export const instanceSettingNamePrefix = "instance/settings/";
export const userNamePrefix = "users/";
export const memoNamePrefix = "memos/";
export const identityProviderNamePrefix = "identity-providers/";

export const buildMemoCreatorFilter = (name: string) => {
  if (!name) {
    return undefined;
  }
  const normalizedName = name.startsWith(userNamePrefix) ? name : `${userNamePrefix}${name}`;
  return `creator == ${JSON.stringify(normalizedName)}`;
};

export const extractMemoIdFromName = (name: string) => {
  return name.split(memoNamePrefix).pop() || "";
};

export const extractUsernameFromName = (name: string) => {
  return name.startsWith(userNamePrefix) ? name.slice(userNamePrefix.length) : name;
};

export const extractIdentityProviderUidFromName = (name: string) => {
  return name.split(identityProviderNamePrefix).pop() || "";
};

// Helper function to convert InstanceSetting_Key enum value to string name
export const getInstanceSettingKeyName = (key: InstanceSetting_Key): string => {
  // TypeScript enum reverse mapping: converts numeric value to string name
  return InstanceSetting_Key[key];
};

// Helper function to build instance setting name from key
export const buildInstanceSettingName = (key: InstanceSetting_Key): string => {
  return `${instanceSettingNamePrefix}${getInstanceSettingKeyName(key)}`;
};

// Helper function to convert UserSetting_Key enum value to string name
export const getUserSettingKeyName = (key: UserSetting_Key): string => {
  // TypeScript enum reverse mapping: converts numeric value to string name
  return UserSetting_Key[key];
};

// Helper function to build user setting name from username and key
export const buildUserSettingName = (username: string, key: UserSetting_Key): string => {
  return `${username}/settings/${getUserSettingKeyName(key)}`;
};

// Namespaces an editor draft cache key by Space, so drafts never bleed across contexts.
// Memos (no Space selected) keeps the bare key it has always used.
export const spaceScopedCacheKey = (baseKey: string, spaceName?: string): string => (spaceName ? `${baseKey}:${spaceName}` : baseKey);
