const express = require('express')
const uuid = require('uuid')

const app = express()

const users = {}
const groups = {}

function createUser(sciminput) {
    const now = new Date()
    const user = {
        ... sciminput,
        'id': uuid.v4(),
        'schemas': ['urn:ietf:params:scim:schemas:core:2.0:User'],
        'meta': {
            'resourceType': 'User',
            'created': now,
            'lastModified': now
        },
    }
    return user
}

function scimError(status) {
    return {
        'schemas': ['urn:ietf:params:scim:api:messages:2.0:Error'],
        'status': status,
    }
}

function scimListReponse(list, filterfn) {
    const result = filterfn ? list.filter(x => filterfn(x)) : list
    return {
        'schemas': ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
        'totalResults': result.length,
        'Resources': result,
        'startIndex': 1,
        'itemsPerPage': result.length + 1
    }
}

app.use(express.json())

app.get('/Users', (req,res) => {
    let fn = undefined
    const filter = (req.query.filter || 'active eq "true"').split(' ')
    console.log(`filter = [${filter}]`)
    const attribute = filter[0]
    const operator = filter[1]
    const value = filter[2].replaceAll('"','')

    fn = (x) => (x[attribute] === value)

    // TODO: email[type eq "work"] type of nested filters

    res.send(scimListReponse(Object.values(users), fn))
})

app.get('/Users/:userId', (req,res) => {
    const user = users[req.params['userId']]
    if (user) {
        res.send(user)
    } else {
        res.status(404).send(scimError(404))
    }
})

app.post('/Users', (req,res) => {
    const user = createUser(req.body)
    users[user.id] = user
    res.status(201).send(user)
})

const server = app.listen(8080)
console.log(`listening on http://localhost:${server.address().port}`)
process.stdin.on('readable', (event) => {
    server.close()
})
