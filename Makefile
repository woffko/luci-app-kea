# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Woffko

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-kea
PKG_VERSION:=0.7.0
PKG_RELEASE:=1

PKG_LICENSE:=Apache-2.0
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=Woffko

LUCI_TITLE:=LuCI support for ISC Kea DHCP server
LUCI_DESCRIPTION:=Web interface for the ISC Kea DHCPv4 and DHCPv6 servers: \
	service control, structured and raw configuration editors, and \
	dnsmasq static lease import.
LUCI_URL:=https://github.com/woffko/luci-app-kea
LUCI_MAINTAINER:=$(PKG_MAINTAINER)
LUCI_DEPENDS:=+luci-base +kea-uci +kea-lfc
LUCI_PKGARCH:=all

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
