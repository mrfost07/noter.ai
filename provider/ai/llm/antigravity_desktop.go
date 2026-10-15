package llm

import (
	"encoding/base64"
	"encoding/json"
	"strings"
)

// DesktopAntigravityClient is supplied by the desktop release build. Installed-app
// OAuth configuration is public client metadata, not a confidential web secret.
// Source builds leave it empty and can supply their own application setup.
var DesktopAntigravityClient string

// BundledAntigravityOAuthClient returns validated desktop-only release configuration.
func BundledAntigravityOAuthClient() (string, string) {
	data, err := base64.StdEncoding.DecodeString(DesktopAntigravityClient)
	if err != nil {
		return "", ""
	}
	var configuration struct {
		Web       json.RawMessage `json:"web"`
		Installed struct {
			ClientID     string `json:"client_id"`
			ClientSecret string `json:"client_secret"`
		} `json:"installed"`
	}
	if json.Unmarshal(data, &configuration) != nil || len(configuration.Web) != 0 {
		return "", ""
	}
	id, secret := configuration.Installed.ClientID, configuration.Installed.ClientSecret
	if len(id) > 512 || !strings.HasSuffix(id, ".apps.googleusercontent.com") || strings.ContainsAny(id, " \t\r\n") || secret == "" || len(secret) > 2048 {
		return "", ""
	}
	return id, secret
}
