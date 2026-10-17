# Run on the old server by run.sh: prints each PDF the old SynergySign kept on its volume (its
# LOCAL_STORAGE_PATH) as "<path><TAB><base64>", the path being what documents.cloudStoragePath holds.
docker exec "${HUB_FILES_CONTAINER:-synergysign-app}" sh -c '
  cd "${LOCAL_STORAGE_PATH:-/data/uploads}" || exit 1
  find documents -type f 2>/dev/null | while IFS= read -r f; do
    printf "%s\t" "$f"; base64 -w0 "$f"; echo
  done'
