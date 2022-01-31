const express = require('express')
const uuid = require('uuid')
const fs = require('fs')

const SAVE_FILE = process.env.SAVE_FILE ?? 'users.json'
const SECRET_TOKEN = process.env.SECRET_TOKEN ?? 'this-is-a-very-secret-token'


function toLowerCaseObject(obj) {
    if (obj instanceof Date) {
        return obj
    }
    if (obj instanceof String) {
        return obj
    }
    if (obj instanceof Array) {
        return obj.map((x) => toLowerCaseObject(x))
    }
    if (obj instanceof Object) {
        const lowerCaseObject = {}
        for (const key in obj) {
            lowerCaseObject[key.toLowerCase()] = toLowerCaseObject(obj[key])
        }
        return lowerCaseObject
    }
    return obj
}


const PATH_SPLIT_EXCEPTIONS = new Set([
    'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager'
])

function evaluatePath(obj, path, asReferrerObject=true) {
    const pathArray = (PATH_SPLIT_EXCEPTIONS.has(path) ? [ path ] : path.split('.')).map(x => x.toLowerCase())
    const attribute = pathArray.pop()

    let target = obj
    for (const step of pathArray) {
        if (target[step] === undefined) {
            target[step] = {}
        }
        target = target[step]
    }
    return asReferrerObject ? {'target':target,'attribute':attribute} : target[attribute]
}

const dump = fs.existsSync(SAVE_FILE) ? JSON.parse(fs.readFileSync(SAVE_FILE)) : {}
const users = toLowerCaseObject(dump)

console.log(`Starting up with ${Object.keys(users).length} registered users`)

function dumpUsers() {
    if (process.env.NOSAVE) { return }
    fs.writeFileSync(SAVE_FILE, JSON.stringify(users))
    console.log(`dumped ${Object.keys(users).length} users to file`)
}

const timer = setInterval(() => dumpUsers(), 5*60*1000)


function createUser(sciminput) {
    const now = new Date()
    const user = {
        ... sciminput,
        'id': uuid.v4(),
        'meta': {
            'resourceType': 'User',
            'created': now,
            'lastModified': now
        }
    }
    user.schemas ??= ['urn:ietf:params:scim:schemas:core:2.0:User']
    return toLowerCaseObject(user)
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


const app = express()

app.use(express.json({'strict':false, 'type':['application/json', 'application/scim+json']}))

if (process.env.DEV) {
    app.get('/token', (req,res) => {
        res.send(JSON.stringify(SECRET_TOKEN))
    })
}

app.all('/scim/*', (req,res,next) => {
    console.log(`Incoming request: ${req.method} ${req.path}`)
    const token = (req.headers.authorization ?? 'Bearer foobar').split(' ')[1]
    if (token !== SECRET_TOKEN) {
        console.log('- request rejected')
        res.status(401).send(scimError(401))
        return false
    }
    req.path = req.path.toLowerCase()
    req.body = toLowerCaseObject(req.body)
    next()
})

app.get('/scim/users', (req,res) => {
    let fn = undefined
    if (req.query.filter) {

        // TODO: support for more complex filters such as email[type eq "work"]

        const filter = req.query.filter.split(' ')
        console.log(`filter = [${filter}]`)
        const path = filter[0]
        const operator = filter[1]
        const value = filter[2].replaceAll('"','')

        fn = (x) => (evaluatePath(x, path, false)=== value)
    }
    res.send(scimListReponse(Object.values(users), fn))
})

app.get('/scim/users/:userId', (req,res) => {
    const user = users[req.params.userId?.toLowerCase()]
    if (user) {
        res.send(user)
    } else {
        res.status(404).send(scimError(404))
    }
})

app.post('/scim/users', (req,res) => {
    const user = createUser(req.body)
    users[user.id] = user
    console.log(`  added new user ${user.id} - ${user.username}`)
    res.status(201).send(user)
})

app.put('/scim/users/:userId', (req,res) => {
    const userId = req.params.userId 
    if (users[userId]) {
        const user = createUser(req.body)
        user.id = userId
        users[userId] = user
        console.log(`  replaced user ${user.id} - ${user.username}`)
        res.status(200).send(user)
    } else {
        res.status(404).send(scimError(404))
    }
})



app.patch('/scim/users/:userId', (req, res) => {
    const user = users[req.params.userId]
    if (user == undefined) {
        res.status(404).send(scimError(404))
        return
    }
    console.log(`Updating: ${user.username}`)
    for (const operation of req.body.operations) {
        const op = operation.op.toLowerCase()
        const { target, attribute } = evaluatePath(user, operation.path)
        const isComplexType = typeof(target[attribute]) === 'object'
        if (op==='add' && isComplexType) {
            console.log(` - APPEND ${operation.path} = ${JSON.stringify(operation.value)}`)
            target[attribute].push(operation.value)
        } else if (op==='add' || op==='replace') {
            console.log(` - SET ${operation.path} = ${JSON.stringify(operation.value)}`)
            target[attribute] = operation.value
        } else if (op==='delete') {
            const value = delete target[attribute]
            console.log(` - DELETE ${operation.path} (was: ${JSON.stringify(value)})`)
        } else {
            console.log(`WARNING: Unsupported operation: ${JSON.stringify(operation)}`)
        }
    }
    user.meta.lastmodified = new Date()
    res.status(200).send(user)
})

app.delete('/scim/users/:userId', (req, res) => {
    const user = users[req.params.userId]
    if (user) {
        console.log(`Deleting ${user.username}`)
        delete users[req.params.userId]
        res.sendStatus(204)
    } else {
        res.status(404).send(scimError(404))
    }
})

const server = app.listen(process.env.PORT || 8080)
console.log(`listening on http://localhost:${server.address().port}`)

if (process.env.DEV) {
    process.stdin.on('readable', (event) => {
        console.log('shutting down')
        clearInterval(timer)
        server.close()
    })
}
