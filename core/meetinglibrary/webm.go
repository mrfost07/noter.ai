package meetinglibrary

import (
	"bytes"
	"encoding/binary"
	"io"
	"math"
	"os"
	"path/filepath"
	"slices"
)

// Live MediaRecorder WebM streams commonly omit Duration. Add it to the bounded
// Info header, streaming the remaining video through a temporary file.
func repairWebMDuration(path string, seconds float64) error {
	var tempName string
	defer func() {
		if tempName != "" {
			os.Remove(tempName)
		}
	}()
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	header := make([]byte, 65536)
	n, readErr := f.Read(header)
	header = header[:n]
	if readErr != nil && readErr != io.EOF {
		f.Close()
		return readErr
	}
	segment := bytes.Index(header, []byte{0x18, 0x53, 0x80, 0x67})
	if segment < 0 {
		f.Close()
		return nil
	} // Other containers/test fixtures are retained unchanged.
	_, segmentWidth := vint(header[segment+4:])
	if segmentWidth == 0 {
		f.Close()
		return nil
	}
	pos := segment + 4 + segmentWidth
	for pos < len(header) {
		_, idWidth := vint(header[pos:])
		if idWidth == 0 {
			break
		}
		idBytes := header[pos : pos+idWidth]
		length, width := vint(header[pos+idWidth:])
		if width == 0 {
			break
		}
		body := pos + idWidth + width
		end := body + int(length)
		if end > len(header) {
			break
		}
		if bytes.Equal(idBytes, []byte{0x15, 0x49, 0xa9, 0x66}) {
			scale := float64(1000000)
			for child := body; child < end; {
				_, cw := vint(header[child:])
				if cw == 0 {
					break
				}
				cl, sw := vint(header[child+cw:])
				if sw == 0 {
					break
				}
				cb := child + cw + sw
				ce := cb + int(cl)
				if ce > end {
					break
				}
				if bytes.Equal(header[child:child+cw], []byte{0x2a, 0xd7, 0xb1}) {
					scale = 0
					for _, v := range header[cb:ce] {
						scale = scale*256 + float64(v)
					}
				}
				if bytes.Equal(header[child:child+cw], []byte{0x44, 0x89}) {
					f.Close()
					return nil
				}
				child = ce
			}
			if scale <= 0 {
				f.Close()
				return nil
			}
			addition := []byte{0x44, 0x89, 0x88, 0, 0, 0, 0, 0, 0, 0, 0}
			binary.BigEndian.PutUint64(addition[3:], math.Float64bits(seconds*1e9/scale))
			newSize := encodeVint(length+uint64(len(addition)), width)
			prefix := slices.Concat(header[:pos+idWidth], newSize, header[body:end], addition)
			// Capture streams have unknown-sized Segment. Keep it unknown after insertion.
			for j := range segmentWidth {
				prefix[segment+4+j] = 0xff
			}
			prefix[segment+4] = byte(0xff >> (segmentWidth - 1))
			tmp, err := os.CreateTemp(filepath.Dir(path), ".noter-webm-*")
			if err != nil {
				f.Close()
				return err
			}
			tempName = tmp.Name()
			_, err = tmp.Write(prefix)
			if err == nil {
				_, err = f.Seek(int64(end), io.SeekStart)
			}
			if err == nil {
				_, err = io.Copy(tmp, f)
			}
			f.Close()
			if err == nil {
				err = tmp.Sync()
			}
			closeErr := tmp.Close()
			if err == nil {
				err = closeErr
			}
			if err != nil {
				return err
			}
			return os.Rename(tempName, path)
		}
		pos = end
	}
	f.Close()
	return nil
}

func vint(data []byte) (uint64, int) {
	if len(data) == 0 || data[0] == 0 {
		return 0, 0
	}
	width := 1
	mask := byte(0x80)
	for data[0]&mask == 0 {
		width++
		mask >>= 1
	}
	if width > 8 || len(data) < width {
		return 0, 0
	}
	value := uint64(data[0] &^ mask)
	for _, b := range data[1:width] {
		value = value<<8 | uint64(b)
	}
	return value, width
}
func encodeVint(value uint64, width int) []byte {
	for value >= (uint64(1)<<(7*width))-1 {
		width++
	}
	out := make([]byte, width)
	for n := width - 1; n >= 0; n-- {
		out[n] = byte(value)
		value >>= 8
	}
	out[0] |= byte(1 << (8 - width))
	return out
}
