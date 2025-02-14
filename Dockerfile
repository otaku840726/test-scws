FROM node:20.18.1 AS base

ENV HOST=0.0.0.0
ENV PORT=4001
ENV SHELL=/bin/bash
# Set environment variables
# ENV NODE_TLS_REJECT_UNAUTHORIZED=0

ENV ALLOWED_HOSTS="localhost"
ENV ADB_DEVICES="redroid-1:5555,redroid-2:5555,redroid-3:5555"

COPY . /workspaces/scwrtc
WORKDIR /workspaces/scwrtc

SHELL ["/bin/bash", "-c"]

RUN chmod +x ./caddy && \
    cp ./caddy /usr/bin/caddy

RUN apt update && \
    apt install wget unzip jq libnss3-tools procps -y && \
    wget https://dl.google.com/android/repository/platform-tools-latest-linux.zip && \
    unzip platform-tools-latest-linux.zip && \
    cp platform-tools/adb /usr/bin/adb && \
    cp ./install/aapt2 /usr/bin/ && \
    npm i -g pnpm && \
    pnpm recursive install 

# Make the shell script executable
RUN chmod +x ./start.sh
RUN chmod +x ./dev.sh
RUN chmod +x ./adb_connect.sh

EXPOSE 3050/tcp
WORKDIR /workspaces/scwrtc
CMD [ "./start.sh" ]