#! /bin/bash

dir=$(dirname $0)

for f in ${dir}/createUser*.json ; do
    curl -d @${f} -H 'Content-Type: application/json' http://localhost:8080/Users
done

