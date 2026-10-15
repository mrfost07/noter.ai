import { create } from "@bufbuild/protobuf";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { useUpdateUserGeneralSetting } from "@/hooks/useUserQueries";
import { UserSetting_GeneralSetting, UserSetting_GeneralSettingSchema } from "@/types/proto/api/user_service_pb";
import { loadLocale, useTranslate } from "@/utils/i18n";
import { loadTheme } from "@/utils/theme";
import LocaleSelect from "../LocaleSelect";
import ThemeSelect from "../ThemeSelect";
import SettingGroup from "./SettingGroup";
import { SettingList, SettingListItem } from "./SettingList";
import SettingSection from "./SettingSection";

const PreferencesSection = () => {
  const t = useTranslate();
  const { currentUser, userGeneralSetting: generalSetting, refetchSettings } = useAuth();
  const { mutate: updateUserGeneralSetting, isPending: isUpdatingGeneralSetting } = useUpdateUserGeneralSetting(currentUser?.name);

  const handleLocaleSelectChange = (locale: Locale) => {
    // Apply locale immediately for instant UI feedback and persist to localStorage
    loadLocale(locale);
    // Persist to user settings
    updateUserGeneralSetting(
      { generalSetting: { locale }, updateMask: ["locale"] },
      {
        onSuccess: () => {
          refetchSettings();
        },
      },
    );
  };

  const handleThemeChange = (theme: string) => {
    // Apply theme immediately for instant UI feedback
    loadTheme(theme);
    // Persist to user settings
    updateUserGeneralSetting(
      { generalSetting: { theme }, updateMask: ["theme"] },
      {
        onSuccess: () => {
          refetchSettings();
        },
      },
    );
  };

  const handleSaveMediaMetadataChange = (saveMediaMetadata: boolean) => {
    updateUserGeneralSetting(
      { generalSetting: { saveMediaMetadata }, updateMask: ["save_media_metadata"] },
      {
        onSuccess: async () => {
          await refetchSettings();
        },
      },
    );
  };

  // Provide default values if setting is not loaded yet
  const setting: UserSetting_GeneralSetting =
    generalSetting ||
    create(UserSetting_GeneralSettingSchema, {
      locale: "en",
      theme: "system",
      saveMediaMetadata: false,
    });

  return (
    <SettingSection title={t("setting.preference.label")}>
      <SettingGroup title={t("setting.preference.appearance-title")} description={t("setting.preference.appearance-description")}>
        <SettingList>
          <SettingListItem label={t("common.language")} description={t("setting.preference.language-description")}>
            <LocaleSelect value={setting.locale} onChange={handleLocaleSelectChange} />
          </SettingListItem>

          <SettingListItem label={t("setting.preference.theme")} description={t("setting.preference.theme-description")}>
            <ThemeSelect value={setting.theme} onValueChange={handleThemeChange} />
          </SettingListItem>
        </SettingList>
      </SettingGroup>

      <SettingGroup
        title={t("setting.preference.uploads-privacy-title")}
        description={t("setting.preference.uploads-privacy-description")}
        showSeparator
      >
        <SettingList>
          <SettingListItem
            label={t("setting.preference.save-media-metadata")}
            description={t("setting.preference.save-media-metadata-description")}
          >
            <Switch
              aria-label={t("setting.preference.save-media-metadata")}
              checked={setting.saveMediaMetadata}
              disabled={isUpdatingGeneralSetting}
              onCheckedChange={handleSaveMediaMetadataChange}
            />
          </SettingListItem>
        </SettingList>
      </SettingGroup>
    </SettingSection>
  );
};

export default PreferencesSection;
