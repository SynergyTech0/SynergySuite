# Apple device management for Synergy Devices: NanoMDM (the Apple MDM protocol) and micromdm/scep
# (device identity certificates), both by the MicroMDM project under the MIT license, built
# unmodified from their releases. One image, two services (see compose.yml). Run from the deploy
# folder:
#   docker build -f apple-mdm.Dockerfile -t synergy/apple-mdm .
ARG NANOMDM_VERSION=v0.9.0
ARG SCEP_VERSION=v2.3.0

FROM golang:1.24-alpine AS build
ARG NANOMDM_VERSION
ARG SCEP_VERSION
ENV CGO_ENABLED=0 GOBIN=/out GOFLAGS=-trimpath
RUN for i in 1 2 3; do \
      go install github.com/micromdm/nanomdm/cmd/nanomdm@${NANOMDM_VERSION} \
      && go install github.com/micromdm/scep/v2/cmd/scepserver@${SCEP_VERSION} && exit 0; \
      echo "download failed, retrying ($i)" >&2; sleep $((i * 5)); \
    done; exit 1

FROM alpine:3.22
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 mdm && mkdir -p /data && chown mdm /data
COPY --from=build /out/nanomdm /out/scepserver /usr/local/bin/
COPY apple-mdm/entrypoint.sh /usr/local/bin/apple-mdm
RUN sed -i 's/\r$//' /usr/local/bin/apple-mdm && chmod +x /usr/local/bin/apple-mdm
USER mdm
ENTRYPOINT ["apple-mdm"]
