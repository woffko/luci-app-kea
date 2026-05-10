include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-kea
PKG_VERSION:=0.1.0
PKG_RELEASE:=1

LUCI_TITLE:=LuCI support for ISC Kea DHCP server
LUCI_DEPENDS:=+luci-base +rpcd +rpcd-mod-file +kea-uci
LUCI_PKGARCH:=all

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Woffko

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
