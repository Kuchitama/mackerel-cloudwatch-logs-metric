#!/bin/bash
CONTAINER=mackerel-agent
IMAGE_NAME=mkr-container

docker build -t ${IMAGE_NAME} .

echo "start container ${CONTAINER}"

docker run -h AWS_LAMBDA \
  --name ${CONTAINER} \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v `pwd`:/var/lib/mackerel-agent/ \
  -e "apikey=${MACKEREL_APIKEY}" \
  -d \
  --rm ${IMAGE_NAME}

echo "started container ${CONTAINER}"

docker cp ${CONTAINER}:/usr/local/bin/mkr ./mkr
chmod 755 ./mkr

docker stop ${CONTAINER}