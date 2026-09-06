package editor

import (
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// DefaultAddr keeps the editor on the loopback interface. It writes to a file
// on disk, so opening it to the network is a deliberate act — pass
// --addr 0.0.0.0:8787 to reach it over Tailscale or a LAN.
const DefaultAddr = "127.0.0.1:8787"

// Serve runs the editor until the process is stopped. Progress and the URLs the
// editor is reachable at are written to out.
func Serve(s *Server, addr string, open bool, out io.Writer) error {
	ln, err := net.Listen("tcp", NormalizeAddr(addr))
	if err != nil {
		return err
	}
	defer ln.Close()

	// Documents are watched per connection, so there is nothing to start here.
	urls := reachableURLs(ln.Addr())
	fmt.Fprintf(out, "serif: editing %s\n", describe(s.Workspace()))
	for i, u := range urls {
		label := "  "
		if i == 0 {
			label = "→ "
		}
		fmt.Fprintf(out, "%s%s\n", label, u)
	}
	if !isLoopback(ln.Addr()) {
		fmt.Fprintln(out, "  (listening beyond localhost — anyone who can reach this address can edit the file)")
	}

	if open && len(urls) > 0 {
		openBrowser(urls[0])
	}

	err = http.Serve(ln, s.Handler())
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

// describe names what is being edited, for the startup line.
func describe(ws *Workspace) string {
	if ws.IsDir() {
		return ws.Root() + string(filepath.Separator)
	}
	return filepath.Join(ws.Root(), ws.Name())
}

// NormalizeAddr accepts a bare port ("8787"), a bare host ("0.0.0.0"), or a
// full "host:port", and fills in the missing half.
func NormalizeAddr(addr string) string {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return DefaultAddr
	}
	if _, port, err := net.SplitHostPort(addr); err == nil && port != "" {
		return addr
	}
	defaultHost, defaultPort, _ := net.SplitHostPort(DefaultAddr)
	if isPort(addr) {
		return net.JoinHostPort(defaultHost, addr)
	}
	return net.JoinHostPort(addr, defaultPort)
}

func isPort(s string) bool {
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return s != ""
}

// reachableURLs lists the addresses the editor can be opened at. When bound to
// every interface, that includes the machine's own IPs — which is how you find
// the Tailscale address to use from another device.
func reachableURLs(addr net.Addr) []string {
	tcp, ok := addr.(*net.TCPAddr)
	if !ok {
		return []string{"http://" + addr.String()}
	}
	port := fmt.Sprint(tcp.Port)

	if !tcp.IP.IsUnspecified() {
		return []string{"http://" + net.JoinHostPort(tcp.IP.String(), port)}
	}

	urls := []string{"http://" + net.JoinHostPort("localhost", port)}
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return urls
	}
	for _, a := range addrs {
		ipnet, ok := a.(*net.IPNet)
		if !ok || ipnet.IP.IsLoopback() || ipnet.IP.IsLinkLocalUnicast() {
			continue
		}
		if ipnet.IP.To4() == nil {
			continue // IPv6 addresses are noisy and rarely the one you want
		}
		urls = append(urls, "http://"+net.JoinHostPort(ipnet.IP.String(), port))
	}
	return urls
}

func isLoopback(addr net.Addr) bool {
	tcp, ok := addr.(*net.TCPAddr)
	return ok && tcp.IP.IsLoopback()
}

func openBrowser(url string) {
	var cmd string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		cmd = "open"
	case "windows":
		cmd, args = "rundll32", []string{"url.dll,FileProtocolHandler"}
	default:
		cmd = "xdg-open"
	}
	_ = exec.Command(cmd, append(args, url)...).Start()
}
