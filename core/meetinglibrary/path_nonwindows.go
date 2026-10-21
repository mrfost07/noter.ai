//go:build !windows

package meetinglibrary

import (
	"os"
	"path/filepath"
)

func libraryPathSpelling(path string, _ os.FileInfo) (string, error) {
	return filepath.Abs(path)
}
