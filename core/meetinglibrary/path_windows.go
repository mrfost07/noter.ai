package meetinglibrary

import (
	"os"
	"path/filepath"
	"syscall"

	"github.com/pkg/errors"
)

func libraryPathSpelling(path string, info os.FileInfo) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	input, err := syscall.UTF16PtrFromString(abs)
	if err != nil {
		return "", err
	}
	if data, ok := info.Sys().(*syscall.Win32FileAttributeData); ok && data.FileAttributes&syscall.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		var found syscall.Win32finddata
		handle, err := syscall.FindFirstFile(input, &found)
		if err != nil {
			return "", err
		}
		_ = syscall.FindClose(handle)
		// The name-surrogate bit covers junctions and symbolic links. Other
		// reparse points (for example OneDrive placeholders) do not redirect a
		// pathname and must not be rejected merely for carrying a reparse tag.
		if found.Reserved0&0x20000000 != 0 {
			return "", errors.New("linked library paths are not supported")
		}
	}
	// EvalSymlinks also expands NTFS 8.3 names, which are ordinary aliases,
	// not links. Normalize their spelling without resolving links before the
	// caller compares paths; GetLongPathName preserves junction components.
	buffer := make([]uint16, syscall.MAX_PATH)
	for {
		n, err := syscall.GetLongPathName(input, &buffer[0], uint32(len(buffer)))
		if err != nil {
			return "", err
		}
		if n < uint32(len(buffer)) {
			return syscall.UTF16ToString(buffer[:n]), nil
		}
		buffer = make([]uint16, n+1)
	}
}
