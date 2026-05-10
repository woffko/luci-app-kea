#!/bin/sh
set -eu

OWNER="${OWNER:-woffko}"
REPO="${REPO:-luci-app-kea}"
VISIBILITY="${VISIBILITY:-public}"
API="https://api.github.com"

case "$VISIBILITY" in
	public|private) ;;
	*)
		echo "VISIBILITY must be public or private" >&2
		exit 1
		;;
esac

if [ -z "${GITHUB_TOKEN:-}" ]; then
	printf "GitHub token: " >&2
	stty -echo
	read -r GITHUB_TOKEN
	stty echo
	printf "\n" >&2
fi

if [ -z "$GITHUB_TOKEN" ]; then
	echo "GITHUB_TOKEN is empty" >&2
	exit 1
fi

private=false
[ "$VISIBILITY" = "private" ] && private=true

status="$(
	curl -sS -o /tmp/luci-app-kea-create-repo.json -w '%{http_code}' \
		-H "Authorization: Bearer $GITHUB_TOKEN" \
		-H "Accept: application/vnd.github+json" \
		-H "X-GitHub-Api-Version: 2022-11-28" \
		"$API/repos/$OWNER/$REPO"
)"

if [ "$status" = "404" ]; then
	status="$(
		curl -sS -o /tmp/luci-app-kea-create-repo.json -w '%{http_code}' \
			-X POST \
			-H "Authorization: Bearer $GITHUB_TOKEN" \
			-H "Accept: application/vnd.github+json" \
			-H "X-GitHub-Api-Version: 2022-11-28" \
			"$API/user/repos" \
			-d "{\"name\":\"$REPO\",\"private\":$private,\"description\":\"LuCI application for managing ISC Kea DHCP server on OpenWrt\",\"has_issues\":true,\"has_projects\":false,\"has_wiki\":false}"
	)"
fi

case "$status" in
	200|201) ;;
	*)
		echo "GitHub API failed with HTTP $status" >&2
		cat /tmp/luci-app-kea-create-repo.json >&2
		exit 1
		;;
esac

git remote set-url origin "https://$OWNER:$GITHUB_TOKEN@github.com/$OWNER/$REPO.git"
git push -u origin main
git remote set-url origin "https://github.com/$OWNER/$REPO.git"

echo "Pushed to https://github.com/$OWNER/$REPO"
